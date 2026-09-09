import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, ChevronDown, Download, Search, ShieldCheck, Trophy, X } from "lucide-react";
import { gameRuleGroups, gameRules, type GameRuleGroup } from "@/data/gameRules";
import { gameRulePath } from "@/data/gameRuleRoutes";
import { GameRuleInstructions } from "@/components/GameRuleInstructions";
import "./GameRules.css";

export default function GameRules() {
  const [group, setGroup] = useState<GameRuleGroup>("All games");
  const [query, setQuery] = useState("");
  const visibleGames = gameRules.filter((game) =>
    (group === "All games" || game.group === group)
    && `${game.name} ${game.aliases ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Game Rules | PINK'D";
    return () => { document.title = previousTitle; };
  }, []);

  return (
    <main className="pinkd-game-rules">
      <header className="rules-header">
        <div className="rules-wrap">
          <Link to="/" aria-label="PINK'D home"><img src="/pinkd-logo.png" alt="PINK'D" /></Link>
          <nav aria-label="Game rules navigation">
            <Link to="/"><ArrowLeft size={16} /> Back to party</Link>
            <Link to="/coins" className="rules-coins">My coins <ArrowUpRight size={16} /></Link>
          </nav>
        </div>
      </header>

      <div className="rules-wrap rules-main">
        <div className="rules-heading">
          <p className="rules-kicker">PINK'D / THE PLAYBOOK</p>
          <h1>Game rules<span>.</span></h1>
          <p>Pick your game. Know the challenge. Make it count.</p>
          <a className="rules-pdf-download" href="/PINKD-Game-Rules.pdf" download="PINKD-Game-Rules.pdf"><Download size={18} /> Download all rules (PDF)</a>
        </div>

        <section className="rules-basics" aria-label="Before you play">
          <div><ShieldCheck size={20} /><p><strong>Play fair.</strong> The runner explains the format and decides disputes. No interference; respect consent. Alcohol is always optional, with a non-alcoholic alternative.</p></div>
          <div><Trophy size={20} /><p><strong>Win a Pinkredible.</strong> Pinkredibles are digital. Each Pinkredible gives Rs. 100 off course registration, not cash. Check your band on <Link to="/coins">My coins</Link>.</p></div>
        </section>

        <div className="rules-controls">
          <div className="rules-filters" role="group" aria-label="Activity group">
            {gameRuleGroups.map((value) => (
              <button key={value} type="button" aria-pressed={group === value} onClick={() => setGroup(value)}>{value}</button>
            ))}
          </div>
          <div className="rules-search">
            <Search size={18} aria-hidden="true" />
            <input type="search" aria-label="Search games" placeholder="Search games" value={query} onChange={(event) => setQuery(event.target.value)} />
            {query && <button type="button" aria-label="Clear search" title="Clear search" onClick={() => setQuery("")}><X size={18} /></button>}
          </div>
        </div>

        <p className="rules-result-count" role="status">{visibleGames.length} {visibleGames.length === 1 ? "activity" : "activities"}</p>
        <div className="rules-grid">
          {visibleGames.map((game) => (
            <article key={game.id} id={game.id} className="rules-game">
              <div className="rules-game-meta"><span>{game.group}</span><strong className={game.group === "Free" ? "rules-free" : ""}>{game.cost}</strong></div>
              <h2>{game.name}</h2>
              <p className="rules-outcome">{game.outcome}</p>
              {game.prize && <p className="rules-prize"><Trophy size={15} />{game.prize}</p>}
              <details>
                <summary>How to play <ChevronDown size={18} /></summary>
                <GameRuleInstructions game={game} />
              </details>
              <Link className="rules-game-link" to={gameRulePath(game.id)}>Open game page & PDF <ArrowUpRight size={16} /></Link>
            </article>
          ))}
        </div>
        {visibleGames.length === 0 && <div className="rules-empty"><h2>No games found</h2><button type="button" onClick={() => { setQuery(""); setGroup("All games"); }}>Show all games</button></div>}

        <footer className="rules-footer">
          <p>Paid play starts after the runner confirms your coin payment. Once a game starts, its entry fee is non-refundable. Free games need no coin payment or NFC scan.</p>
          <p>Listed game fees follow the event setup; confirm the fee and local format with the runner before paying. Donations start at 150 whole coins. Party entry is 18+.</p>
          <Link to="/contact-us">Ask the PINK'D team <ArrowUpRight size={15} /></Link>
          <a className="rules-qr-link" href="/game-rules-qr.png" download="PINKD-Game-Rules-QR.png">Download game rules QR <ArrowUpRight size={15} /></a>
        </footer>
      </div>
    </main>
  );
}
