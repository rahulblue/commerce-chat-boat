import { Bot, Loader2, LogOut, Send, UserRound } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";
const CHAT_URL = import.meta.env.VITE_CHAT_API_URL || `${API_BASE}/api/chat`;

const suggestedQuestions = [
  "Show recent orders",
  "Total number of orders of Anirudh",
  "What is the status of order 100000123?",
  "What is the status of order 000008627?",
  "Has order 100000124 shipped?",
  "Show top 5 selling products last month",
];

const defaultGreeting = {
  role: "assistant",
  content:
    "Ask about orders, shipments, returns, top-selling products, or sales summaries. I will answer from approved commerce tools.",
};

export default function App() {
  const [authState, setAuthState] = useState("checking");
  const [username, setUsername] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [messages, setMessages] = useState([defaultGreeting]);
  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [lastToolCalls, setLastToolCalls] = useState(null);

  const canSend = useMemo(() => question.trim().length > 0 && !isLoading, [question, isLoading]);

  useEffect(() => {
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkAuth() {
    try {
      const healthRes = await fetch(`${API_BASE}/api/health`);
      const health = await healthRes.json();

      if (!health.authRequired) {
        setAuthState("anonymous");
        return;
      }

      const meRes = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" });

      if (!meRes.ok) {
        setAuthState("needs-login");
        return;
      }

      const me = await meRes.json();
      setUsername(me.username);
      await loadHistory();
      setAuthState("authenticated");
    } catch (error) {
      setAuthState("needs-login");
    }
  }

  async function loadHistory() {
    try {
      const res = await fetch(`${API_BASE}/api/chat/history`, { credentials: "include" });

      if (!res.ok) {
        return;
      }

      const { messages: history } = await res.json();

      if (history?.length) {
        setMessages(history.map((item) => ({ role: item.role, content: item.content })));
      }
    } catch (error) {
      // Keep the default greeting if history can't be loaded.
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm),
      });
      const payload = await res.json();

      if (!res.ok) {
        setLoginError(payload.error || "Login failed.");
        return;
      }

      setUsername(payload.username);
      setLoginForm({ username: "", password: "" });
      await loadHistory();
      setAuthState("authenticated");
    } catch (error) {
      setLoginError("Could not reach the server. Please try again.");
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleLogout() {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, { method: "POST", credentials: "include" });
    } catch (error) {
      // Clear local state regardless of network failure.
    }

    setUsername(null);
    setMessages([defaultGreeting]);
    setLastToolCalls(null);
    setAuthState("needs-login");
  }

  async function submitQuestion(nextQuestion = question) {
    const trimmed = nextQuestion.trim();

    if (!trimmed || isLoading) {
      return;
    }

    const nextMessages = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setQuestion("");
    setIsLoading(true);
    setLastToolCalls(null);

    try {
      const response = await fetch(CHAT_URL, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: trimmed,
          history: nextMessages,
        }),
      });

      if (response.status === 401) {
        setAuthState("needs-login");
        setMessages([defaultGreeting]);
        return;
      }

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Request failed.");
      }

      setMessages((current) => [...current, { role: "assistant", content: payload.answer }]);
      setLastToolCalls(payload.toolCalls?.length ? payload.toolCalls : payload.tool ? [payload.tool] : null);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: `I could not complete that request. ${error.message}`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  if (authState === "checking") {
    return (
      <main className="app-shell centered">
        <Loader2 size={24} className="spin" />
      </main>
    );
  }

  if (authState === "needs-login") {
    return (
      <main className="app-shell centered">
        <form className="login-card" onSubmit={handleLogin}>
          <p className="eyebrow">Operations Assistant</p>
          <h1>Commerce Admin Chatbot</h1>
          <p className="login-subtitle">Sign in with your Adobe Commerce admin account.</p>

          <label>
            Username
            <input
              value={loginForm.username}
              onChange={(event) => setLoginForm((form) => ({ ...form, username: event.target.value }))}
              autoComplete="username"
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={loginForm.password}
              onChange={(event) => setLoginForm((form) => ({ ...form, password: event.target.value }))}
              autoComplete="current-password"
              required
            />
          </label>

          {loginError && <p className="login-error">{loginError}</p>}

          <button type="submit" disabled={isLoggingIn}>
            {isLoggingIn ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Operations Assistant</p>
          <h1>Commerce Admin Chatbot</h1>
        </div>

        {username && (
          <section className="tool-panel" aria-label="Account">
            <h2>Signed in as</h2>
            <p className="tool-name">{username}</p>
            <button type="button" className="logout-button" onClick={handleLogout}>
              <LogOut size={14} /> Log out
            </button>
          </section>
        )}

        <section className="tool-panel" aria-label="Available topics">
          <h2>Available Topics</h2>
          <ul>
            <li>Orders and payment status</li>
            <li>Recent order lists</li>
            <li>Customer order counts</li>
            <li>Shipments and tracking</li>
            <li>Returns and RMA state</li>
            <li>Top-selling products</li>
            <li>Sales summaries</li>
          </ul>
        </section>

        {lastToolCalls?.length > 0 && (
          <section className="tool-panel" aria-label="Tools used for the last answer">
            <h2>{lastToolCalls.length > 1 ? "Tools Used" : "Last Tool"}</h2>
            {lastToolCalls.map((call, index) => (
              <div key={`${call.name}-${index}`} className="tool-call">
                <p className="tool-name">{call.name}</p>
                <p className="tool-source">Source: {call.source}</p>
              </div>
            ))}
          </section>
        )}
      </aside>

      <section className="chat-workspace" aria-label="Chat workspace">
        <div className="messages">
          {messages.map((message, index) => (
            <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
              <div className="avatar" aria-hidden="true">
                {message.role === "assistant" ? <Bot size={18} /> : <UserRound size={18} />}
              </div>
              <div className="bubble">
                {message.content.split("\n").map((line, lineIndex) => (
                  <p key={`${index}-${lineIndex}`}>{line}</p>
                ))}
              </div>
            </article>
          ))}

          {isLoading && (
            <article className="message assistant">
              <div className="avatar" aria-hidden="true">
                <Bot size={18} />
              </div>
              <div className="bubble loading">
                <Loader2 size={18} />
                Checking commerce data
              </div>
            </article>
          )}
        </div>

        <div className="suggestions" aria-label="Suggested questions">
          {suggestedQuestions.map((item) => (
            <button key={item} type="button" onClick={() => submitQuestion(item)} disabled={isLoading}>
              {item}
            </button>
          ))}
        </div>

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            submitQuestion();
          }}
        >
          <input
            aria-label="Ask a commerce question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask about an order, return, shipment, or product sales"
          />
          <button type="submit" disabled={!canSend} aria-label="Send question" title="Send question">
            {isLoading ? <Loader2 size={19} /> : <Send size={19} />}
          </button>
        </form>
      </section>
    </main>
  );
}
