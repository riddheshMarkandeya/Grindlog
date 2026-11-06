import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { shouldRetry } from "./api";
import { App } from "./App";
import "./styles/global.css";

// Freshness comes from the events stream (match_ended, session_break, reconnect), not from timers or focus.
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: shouldRetry } } });

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Location state follows history at once rather than in a transition, so a redirect that lands
          while a click's navigation is still rendering can't replace the page the click went to. */}
      <BrowserRouter useTransitions={false}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
