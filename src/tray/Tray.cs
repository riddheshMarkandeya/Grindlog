// Grindlog's notification-area icon. The supervisor starts it with everything it needs on the
// command line, reads its stdout as log lines, and closes its stdin to tell it to go. It only
// talks to the tracker over HTTP, so a crash here never touches recording.
// Built by the OS csc.exe (C# 5): no string interpolation, ?., nameof or expression-bodied members.
using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
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

        /// <summary>Writes {"event":name, key: value, ...}; ints and longs go in as numbers.</summary>
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

    class TrayContext : ApplicationContext
    {
        readonly Options options;
        readonly NotifyIcon icon;
        // A handle on the UI thread, so the stdin watcher can marshal onto it.
        readonly Control invoker;
        // A loop that ends without Exit (some outside WM_QUIT) reads as a crash, never as a quit.
        public int ExitCode = ExitCodes.Crashed;
        bool exited;

        public TrayContext(Options options)
        {
            this.options = options;
            invoker = new Control();
            invoker.CreateControl();
            IntPtr unused = invoker.Handle;

            var menu = new ContextMenuStrip();
            menu.Items.Add("Open dashboard", null, delegate { Open(DashboardUrl()); });
            menu.Items.Add("Open logs folder", null, delegate { Open(options.Logs); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Quit " + options.Name, null, delegate { Quit(); });

            icon = new NotifyIcon();
            icon.Icon = LoadIcon();
            // The tooltip is capped at 63 characters.
            icon.Text = options.Name.Length > 63 ? options.Name.Substring(0, 63) : options.Name;
            icon.ContextMenuStrip = menu;
            icon.MouseClick += delegate(object sender, MouseEventArgs e)
            {
                if (e.Button == MouseButtons.Left) Open(DashboardUrl());
            };
            icon.Visible = true;
            Program.Icon = icon;

            var watcher = new Thread(WatchStdin);
            watcher.IsBackground = true;
            watcher.Start();
        }

        string DashboardUrl()
        {
            return "http://127.0.0.1:" + options.Port.ToString(CultureInfo.InvariantCulture) + "/";
        }

        static System.Drawing.Icon LoadIcon()
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Grindlog.tray.ico"))
            {
                return new System.Drawing.Icon(s, SystemInformation.SmallIconSize);
            }
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

        /// <summary>Like "26200.7171". Environment.OSVersion reports 6.2 for an exe without a manifest.</summary>
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
