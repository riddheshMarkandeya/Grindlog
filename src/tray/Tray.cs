// Grindlog's notification-area icon. The supervisor starts it with everything it needs on the
// command line, reads its stdout as log lines, and closes its stdin to tell it to go. It only
// talks to the tracker over HTTP, so a crash here never touches recording. It polls GET /api/tray
// for what to show; the tracker works the view out, and the tray adds only what it alone can know:
// "Starting..." before the first answer and "Not responding" when answers stop.
// Built by the OS csc.exe (C# 5): no string interpolation, ?., nameof or expression-bodied members.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Grindlog.Tray
{
    /// <summary>Exit codes the supervisor reads, mirrored by its TRAY_EXIT_* constants. Only Quit means the user asked to stop the app.</summary>
    static class ExitCodes
    {
        public const int Quit = 0;
        public const int Crashed = 1;
        public const int BadArgs = 2;
        public const int StdinClosed = 3;
    }

    /// <summary>One JSON object per stdout line; the supervisor writes them into supervisor.log.</summary>
    static class Log
    {
        static readonly object Gate = new object();
        // UTF-8 without a BOM: a redirected Console.Out would use the OEM code page and garble
        // a non-ASCII username in a path.
        static readonly StreamWriter Out = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };

        /// <summary>Writes {"event":name, key: value, ...}; ints and longs go in as numbers, bools as booleans.</summary>
        public static void Write(string name, params object[] fields)
        {
            var sb = new StringBuilder("{\"event\":");
            Quote(sb, name);
            for (int i = 0; i + 1 < fields.Length; i += 2)
            {
                sb.Append(',');
                Quote(sb, Convert.ToString(fields[i], CultureInfo.InvariantCulture));
                sb.Append(':');
                object v = fields[i + 1];
                if (v is int || v is long) sb.Append(Convert.ToString(v, CultureInfo.InvariantCulture));
                else if (v is bool) sb.Append((bool)v ? "true" : "false");
                else if (v == null) sb.Append("null");
                else Quote(sb, Convert.ToString(v, CultureInfo.InvariantCulture));
            }
            sb.Append('}');
            lock (Gate)
            {
                try
                {
                    Out.WriteLine(sb.ToString());
                }
                catch (IOException)
                {
                    // The supervisor is gone (broken pipe). Nothing can read the line, and the
                    // crash handler calls this too, so it must not throw.
                }
            }
        }

        static void Quote(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                if (c == '"') sb.Append("\\\"");
                else if (c == '\\') sb.Append("\\\\");
                else if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4"));
                else sb.Append(c);
            }
            sb.Append('"');
        }
    }

    class Options
    {
        public int Port;
        public string Name;
        public string Logs;
        public string Version;
        public string Channel;

        /// <summary>Null when a required argument is missing or malformed.</summary>
        public static Options Parse(string[] args)
        {
            var o = new Options();
            for (int i = 0; i + 1 < args.Length; i += 2)
            {
                string v = args[i + 1];
                switch (args[i])
                {
                    case "--port":
                        if (!int.TryParse(v, NumberStyles.None, CultureInfo.InvariantCulture, out o.Port)) return null;
                        break;
                    case "--name": o.Name = v; break;
                    case "--logs": o.Logs = v; break;
                    case "--version": o.Version = v; break;
                    case "--channel": o.Channel = v; break;
                    default: return null;
                }
            }
            if (args.Length % 2 != 0 || o.Port < 1 || o.Port > 65535 || string.IsNullOrEmpty(o.Name) || string.IsNullOrEmpty(o.Logs)) return null;
            return o;
        }
    }

    class TrayLine
    {
        public string Text;
        public string Url;
    }

    class TrayNotice
    {
        public int Id;
        public string Title;
        public string Body;
    }

    /// <summary>GET /api/tray's answer, checked field by field: whatever holds the port wrote it.</summary>
    class TrayView
    {
        public string Icon;
        public string Status;
        public readonly List<TrayLine> Lines = new List<TrayLine>();
        public string SetupUrl;
        public string Instance;
        public readonly List<TrayNotice> Notices = new List<TrayNotice>();

        /// <summary>Null when the JSON doesn't have the expected shape; throws on malformed JSON.</summary>
        public static TrayView Parse(string json)
        {
            var root = new JavaScriptSerializer().DeserializeObject(json) as Dictionary<string, object>;
            if (root == null) return null;
            var v = new TrayView();
            v.Icon = Str(root, "icon");
            v.Status = Str(root, "status");
            if (v.Icon != "ready" && v.Icon != "active" && v.Icon != "attention") return null;
            if (v.Status == null || !root.ContainsKey("setupUrl")) return null;
            v.SetupUrl = Str(root, "setupUrl");
            if (v.SetupUrl == null && root["setupUrl"] != null) return null;
            v.Instance = Str(root, "instance");
            if (v.Instance == null) return null;

            object[] lines = Arr(root, "lines");
            object[] notices = Arr(root, "notices");
            if (lines == null || notices == null) return null;
            foreach (object o in lines)
            {
                var d = o as Dictionary<string, object>;
                if (d == null || Str(d, "text") == null) return null;
                var line = new TrayLine();
                line.Text = Str(d, "text");
                line.Url = Str(d, "url");
                v.Lines.Add(line);
            }
            foreach (object o in notices)
            {
                var d = o as Dictionary<string, object>;
                object id;
                if (d == null || !d.TryGetValue("id", out id) || !(id is int) || Str(d, "title") == null || Str(d, "body") == null) return null;
                var n = new TrayNotice();
                n.Id = (int)id;
                n.Title = Str(d, "title");
                n.Body = Str(d, "body");
                v.Notices.Add(n);
            }
            return v;
        }

        static string Str(Dictionary<string, object> d, string key)
        {
            object o;
            return d.TryGetValue(key, out o) ? o as string : null;
        }

        static object[] Arr(Dictionary<string, object> d, string key)
        {
            object o;
            return d.TryGetValue(key, out o) ? o as object[] : null;
        }
    }

    /// <summary>What the next poll acks: the highest notice id shown, and the tracker run that numbered it.</summary>
    class Ack
    {
        public readonly int Id;
        public readonly string Instance;
        public Ack(int id, string instance) { Id = id; Instance = instance; }
    }

    enum PollKind { Answered, Starting, Bad, Failed }

    class PollResult
    {
        public PollKind Kind;
        public TrayView View;
        public string Error;
    }

    class TrayContext : ApplicationContext
    {
        const int PollMs = 2000;
        const int RetryMs = 500;
        const int RequestTimeoutMs = 1500;
        // Red at startup only after this long with no answer at all: the supervisor starts the
        // tracker alongside the tray, and it opens storage before it listens.
        const int StartupGraceMs = 15000;
        // Two failed polls in a row after an answer: one can be a blip.
        const int FailuresBeforeRed = 2;
        const int BalloonMs = 5000;
        const int MaxBodyChars = 65536;
        const string Starting = "Starting…";
        const string NotResponding = "Not responding";

        readonly Options options;
        readonly NotifyIcon icon;
        readonly ContextMenuStrip menu;
        readonly Dictionary<string, System.Drawing.Icon> icons = new Dictionary<string, System.Drawing.Icon>();
        // A handle on the UI thread, so the stdin watcher and the poller can marshal onto it.
        readonly Control invoker;
        readonly Stopwatch sinceStart = Stopwatch.StartNew();
        // A loop that ends without Exit (some outside WM_QUIT) reads as a crash, never as a quit.
        public int ExitCode = ExitCodes.Crashed;
        // Read by the poll thread.
        volatile bool exited;
        // Replaced whole, so the poll thread never pairs one run's id with another's instance.
        // Written on the UI thread only; null before the first answer.
        volatile Ack ack;
        // Kept across polls: at 128 KB it would land on the large object heap every 2 s. Poll thread only.
        readonly char[] bodyBuffer = new char[MaxBodyChars + 1];

        // UI-thread state from here.
        TrayView lastView;
        // Whether the icon and status shown are lastView's, rather than "Starting..." or "Not responding".
        bool showingView;
        string shownIcon;
        string shownStatus;
        bool everAnswered;
        int failStreak;
        bool unreachable;
        bool badStreak;
        // How many of the menu's first items were built from the view, to replace on the next open.
        int dynamicItems;

        public TrayContext(Options options)
        {
            this.options = options;
            invoker = new Control();
            invoker.CreateControl();
            IntPtr unused = invoker.Handle;

            foreach (string state in new[] { "ready", "active", "attention", "stopped" }) icons[state] = LoadIcon(state);

            menu = new ContextMenuStrip();
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Open dashboard", null, delegate { Open(DashboardUrl()); });
            menu.Items.Add("Open logs folder", null, delegate { Open(options.Logs); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Quit " + options.Name, null, delegate { Quit(); });
            // Built as it opens, so an open menu never changes under the cursor.
            menu.Opening += delegate(object sender, CancelEventArgs e) { RebuildTop(); };

            icon = new NotifyIcon();
            icon.ContextMenuStrip = menu;
            icon.MouseClick += delegate(object sender, MouseEventArgs e)
            {
                if (e.Button == MouseButtons.Left) Open(DashboardUrl());
            };
            icon.BalloonTipClicked += delegate { Open(DashboardUrl()); };
            Show("ready", Starting, false);
            icon.Visible = true;
            Program.Icon = icon;

            var watcher = new Thread(WatchStdin);
            watcher.IsBackground = true;
            watcher.Start();
            var poller = new Thread(PollLoop);
            poller.IsBackground = true;
            poller.Start();
        }

        string Origin()
        {
            return "http://127.0.0.1:" + options.Port.ToString(CultureInfo.InvariantCulture);
        }

        string DashboardUrl()
        {
            return Origin() + "/";
        }

        /// <summary>
        /// A dashboard path from the view as a full URL, or null. Only "/..." paths open: the view
        /// comes from whatever holds the port, and Process.Start would open a file or any scheme.
        /// </summary>
        string ViewUrl(string url)
        {
            bool ok = url != null && url.StartsWith("/", StringComparison.Ordinal) && !url.StartsWith("//", StringComparison.Ordinal);
            if (ok)
            {
                foreach (char c in url)
                {
                    if (c <= ' ' || c == '\\' || c == '"') { ok = false; break; }
                }
            }
            if (ok) return Origin() + url;
            Log.Write("url_rejected", "url", url);
            return null;
        }

        static System.Drawing.Icon LoadIcon(string state)
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Grindlog.tray." + state + ".ico"))
            {
                // SmallIconSize follows the display scale because the manifest marks the exe DPI-aware.
                return new System.Drawing.Icon(s, SystemInformation.SmallIconSize);
            }
        }

        void PollLoop()
        {
            while (!exited)
            {
                PollResult result = PollOnce();
                try
                {
                    invoker.BeginInvoke(new MethodInvoker(delegate
                    {
                        if (!exited) Apply(result);
                    }));
                }
                catch (InvalidOperationException)
                {
                    // The handle is gone: the tray is exiting.
                    return;
                }
                // Sooner after a failure: a refused connection on Windows waits out the whole request
                // timeout, and red should follow a stop within ~5 s.
                Thread.Sleep(result.Kind == PollKind.Failed ? RetryMs : PollMs);
            }
        }

        PollResult PollOnce()
        {
            var result = new PollResult();
            try
            {
                Ack a = ack;
                string query = a == null ? "" : "?ack=" + a.Id.ToString(CultureInfo.InvariantCulture) + "&instance=" + Uri.EscapeDataString(a.Instance);
                var req = (HttpWebRequest)WebRequest.Create(Origin() + "/api/tray" + query);
                req.Proxy = null;
                req.Timeout = RequestTimeoutMs;
                req.ReadWriteTimeout = RequestTimeoutMs;
                req.Headers.Add("X-Grindlog-Tray", "1");
                // Disposed every time: an undisposed response holds one of the two connections per
                // host, and later polls hang waiting for it.
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                {
                    // Capped: whatever holds the port could send an endless body.
                    char[] buf = bodyBuffer;
                    int read = 0, got;
                    while (read < buf.Length && (got = reader.Read(buf, read, buf.Length - read)) > 0) read += got;
                    if (read > MaxBodyChars)
                    {
                        result.Kind = PollKind.Bad;
                        result.Error = "body over " + MaxBodyChars.ToString(CultureInfo.InvariantCulture) + " chars";
                        return result;
                    }
                    string body = new string(buf, 0, read);
                    try
                    {
                        result.View = TrayView.Parse(body);
                        if (result.View == null) result.Error = "unexpected shape";
                    }
                    catch (ArgumentException e)
                    {
                        // JavaScriptSerializer's error for malformed JSON.
                        result.Error = e.Message;
                    }
                    catch (InvalidOperationException e)
                    {
                        // And for JSON nested past its limit.
                        result.Error = e.Message;
                    }
                    result.Kind = result.View != null ? PollKind.Answered : PollKind.Bad;
                }
            }
            catch (WebException e)
            {
                result.Kind = PollKind.Failed;
                result.Error = e.Status.ToString() + ": " + e.Message;
                if (e.Status == WebExceptionStatus.ProtocolError && e.Response != null)
                {
                    using (var resp = (HttpWebResponse)e.Response)
                    {
                        // 503 is the tracker starting up, or stopping during a shutdown. Any other
                        // status still means something is answering, so it's a bad answer, not red.
                        int code = (int)resp.StatusCode;
                        result.Kind = code == 503 ? PollKind.Starting : PollKind.Bad;
                        result.Error = "http " + code.ToString(CultureInfo.InvariantCulture);
                    }
                }
            }
            catch (IOException e)
            {
                // A connection cut mid-read.
                result.Kind = PollKind.Failed;
                result.Error = e.Message;
            }
            return result;
        }

        void Apply(PollResult r)
        {
            if (r.Kind == PollKind.Failed)
            {
                failStreak++;
                if (failStreak == 1) Log.Write("poll_failed", "error", r.Error);
                bool red = everAnswered ? failStreak >= FailuresBeforeRed : sinceStart.ElapsedMilliseconds >= StartupGraceMs;
                if (red && !unreachable)
                {
                    unreachable = true;
                    Log.Write("unreachable", "failures", failStreak, "everAnswered", everAnswered);
                    Show("stopped", NotResponding, false);
                }
                return;
            }

            // Anything that answered, even a 503 or bad JSON, means the tracker is alive.
            failStreak = 0;
            everAnswered = true;
            if (unreachable)
            {
                unreachable = false;
                Log.Write("reachable");
            }

            if (r.Kind == PollKind.Starting)
            {
                badStreak = false;
                Show("ready", Starting, false);
                return;
            }
            if (r.Kind == PollKind.Bad)
            {
                // Keeps the last view and acks nothing: the notices weren't read.
                if (!badStreak) Log.Write("view_bad", "error", r.Error);
                badStreak = true;
                // After an outage the last view is stale, so a tracker that answers but not usefully
                // shows as starting rather than as what it was before it stopped.
                if (shownIcon == "stopped") Show("ready", Starting, false);
                return;
            }

            badStreak = false;
            lastView = r.View;
            Show(r.View.Icon, r.View.Status, true);
            ShowNotices(r.View);
        }

        void ShowNotices(TrayView view)
        {
            // A restarted tracker numbers its notices from 1 again.
            int shown = ack != null && ack.Instance == view.Instance ? ack.Id : 0;
            foreach (TrayNotice n in view.Notices)
            {
                if (n.Id <= shown) continue;
                icon.ShowBalloonTip(BalloonMs, n.Title, n.Body, ToolTipIcon.None);
                Log.Write("balloon_shown", "id", n.Id, "title", n.Title);
                shown = n.Id;
            }
            ack = new Ack(shown, view.Instance);
        }

        /// <summary>Sets the icon and tooltip, touching each only when it changed.</summary>
        void Show(string state, string status, bool fromView)
        {
            showingView = fromView;
            if (state == shownIcon && status == shownStatus) return;
            if (state != shownIcon) icon.Icon = icons[state];
            shownIcon = state;
            shownStatus = status;
            string tip = options.Name + ": " + status;
            // The tooltip is capped at 63 characters.
            icon.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;
            Log.Write("view", "icon", state, "status", status);
        }

        void RebuildTop()
        {
            for (int i = 0; i < dynamicItems; i++)
            {
                ToolStripItem old = menu.Items[0];
                menu.Items.RemoveAt(0);
                old.Dispose();
            }
            var items = new List<ToolStripItem>();
            var status = new ToolStripMenuItem(shownStatus);
            status.Enabled = false;
            items.Add(status);
            // Lines and setup belong to the view shown; "Starting..." and "Not responding" stand alone.
            if (showingView && lastView != null)
            {
                foreach (TrayLine line in lastView.Lines)
                {
                    var item = new ToolStripMenuItem(line.Text);
                    if (line.Url == null) item.Enabled = false;
                    else
                    {
                        string url = line.Url;
                        item.Click += delegate { OpenViewUrl(url); };
                    }
                    items.Add(item);
                }
                if (lastView.SetupUrl != null)
                {
                    string setup = lastView.SetupUrl;
                    items.Add(new ToolStripMenuItem("Set up Stats API…", null, delegate { OpenViewUrl(setup); }));
                }
            }
            for (int i = 0; i < items.Count; i++) menu.Items.Insert(i, items[i]);
            dynamicItems = items.Count;
        }

        void OpenViewUrl(string url)
        {
            string target = ViewUrl(url);
            if (target != null) Open(target);
        }

        static void Open(string target)
        {
            try
            {
                Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
            }
            catch (Exception e)
            {
                // Deliberately broad: Win32Exception, FileNotFound and others all mean the same
                // thing here (nothing opened), and the tray must keep running.
                Log.Write("open_failed", "target", target, "error", e.Message);
            }
        }

        void WatchStdin()
        {
            var buf = new byte[256];
            try
            {
                using (Stream stdin = Console.OpenStandardInput())
                {
                    while (stdin.Read(buf, 0, buf.Length) > 0) { }
                }
            }
            catch (IOException)
            {
                // A broken pipe means the supervisor went away: the same as EOF.
            }
            try
            {
                invoker.BeginInvoke(new MethodInvoker(delegate
                {
                    if (exited) return;
                    Log.Write("stdin_closed");
                    Exit(ExitCodes.StdinClosed);
                }));
            }
            catch (InvalidOperationException)
            {
                // The handle is gone: Quit already ended the loop, and its exit code stands.
            }
        }

        void Quit()
        {
            Log.Write("quit_clicked");
            Exit(ExitCodes.Quit);
        }

        void Exit(int code)
        {
            // Once: a stdin close queued behind Quit must not turn its 0 into a 3.
            if (exited) return;
            exited = true;
            ExitCode = code;
            // Hidden before exit, or the icon stays as a ghost until hovered.
            icon.Visible = false;
            icon.Dispose();
            menu.Dispose();
            ExitThread();
        }
    }

    static class Program
    {
        /// <summary>Set once shown, so the crash handler can take it down.</summary>
        public static NotifyIcon Icon;

        [STAThread]
        static int Main(string[] args)
        {
            // First, before any control exists: otherwise WinForms shows a modal crash dialog and
            // the process hangs instead of exiting where the supervisor can restart it.
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
            AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs e)
            {
                Log.Write("crashed", "error", Convert.ToString(e.ExceptionObject));
                try
                {
                    if (Icon != null) Icon.Visible = false;
                }
                catch (Exception)
                {
                    // Best-effort on the way out; exiting matters more than the ghost icon.
                }
                Environment.Exit(ExitCodes.Crashed);
            };

            var options = Options.Parse(args);
            if (options == null)
            {
                Log.Write("bad_args", "args", string.Join(" ", args));
                return ExitCodes.BadArgs;
            }
            Log.Write("started",
                "pid", Process.GetCurrentProcess().Id,
                "version", options.Version,
                "channel", options.Channel,
                "windowsBuild", WindowsBuild(),
                "dotnetRelease", DotnetRelease());

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var context = new TrayContext(options);
            Application.Run(context);
            return context.ExitCode;
        }

        /// <summary>Like "26200.7171", read from the registry: Environment.OSVersion has no UBR.</summary>
        static string WindowsBuild()
        {
            try
            {
                using (RegistryKey k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion"))
                {
                    if (k == null) return null;
                    object build = k.GetValue("CurrentBuild");
                    object ubr = k.GetValue("UBR");
                    return Convert.ToString(build, CultureInfo.InvariantCulture) + (ubr == null ? "" : "." + Convert.ToString(ubr, CultureInfo.InvariantCulture));
                }
            }
            catch (Exception)
            {
                // Deliberately broad (security, IO): the value only decorates the started line.
                return null;
            }
        }

        /// <summary>The .NET Framework 4.x release number (528040+ is 4.8), or null.</summary>
        static object DotnetRelease()
        {
            try
            {
                using (RegistryKey k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full"))
                {
                    return k == null ? null : k.GetValue("Release");
                }
            }
            catch (Exception)
            {
                // As above: only decoration.
                return null;
            }
        }
    }
}
