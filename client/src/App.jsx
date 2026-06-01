import { Bot, Loader2, Send, UserRound } from "lucide-react";
import React, { useMemo, useState } from "react";

const suggestedQuestions = [
  "Show recent orders",
  "Total number of orders of Anirudh",
  "What is the status of order 100000123?",
  "What is the status of order 000008627?",
  "Has order 100000124 shipped?",
  "Show top 5 selling products last month",
];

export default function App() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Ask about orders, shipments, returns, top-selling products, or sales summaries. I will answer from approved commerce tools.",
    },
  ]);
  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [lastTool, setLastTool] = useState(null);

  const canSend = useMemo(() => question.trim().length > 0 && !isLoading, [question, isLoading]);

  async function submitQuestion(nextQuestion = question) {
    const trimmed = nextQuestion.trim();

    if (!trimmed || isLoading) {
      return;
    }

    const nextMessages = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setQuestion("");
    setIsLoading(true);
    setLastTool(null);

    try {
      const apiUrl = import.meta.env.VITE_CHAT_API_URL || "http://localhost:4000/api/chat";
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: trimmed,
          history: nextMessages,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Request failed.");
      }

      setMessages((current) => [...current, { role: "assistant", content: payload.answer }]);
      setLastTool(payload.tool);
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

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Operations Assistant</p>
          <h1>Commerce Admin Chatbot</h1>
        </div>

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

        {lastTool && (
          <section className="tool-panel" aria-label="Last tool used">
            <h2>Last Tool</h2>
            <p className="tool-name">{lastTool.name}</p>
            <p className="tool-source">Source: {lastTool.source}</p>
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
