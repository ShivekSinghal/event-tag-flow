import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Download, Trophy } from "lucide-react";
import { gameRules } from "@/data/gameRules";
import { gameRuleRouteIds } from "@/data/gameRuleRoutes";
import { GameRuleInstructions } from "@/components/GameRuleInstructions";
import "./GameRules.css";

export default function GameRulePage() {
  const { gameId } = useParams();
  const game = gameRules.find((item) => gameRuleRouteIds[item.id] === gameId);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${game?.name ?? "Game not found"} | PINK'D Game Rules`;
    window.scrollTo(0, 0);
    return () => { document.title = previousTitle; };
  }, [game]);

  return <main className="pinkd-game-rules">
    <header className="rules-header">
      <div className="rules-wrap">
        <Link to="/" aria-label="PINK'D home"><img src="/pinkd-logo.png" alt="PINK'D" /></Link>
        <nav aria-label="Game rules navigation">
          <Link to="/game-rules"><ArrowLeft size={16} /> All games</Link>
          <Link to="/coins" className="rules-coins">My coins <ArrowUpRight size={16} /></Link>
        </nav>
      </div>
    </header>
    <div className="rules-wrap rules-main rules-single">
      {game ? <>
        <div className="rules-heading">
          <p className="rules-kicker">PINK'D / {game.group.toUpperCase()}</p>
          <h1>{game.name}<span>.</span></h1>
          <p>{game.outcome}</p>
          <div className="rules-single-meta">
            <strong className={game.group === "Free" ? "rules-free" : ""}>{game.cost}</strong>
            {game.prize && <span className="rules-prize"><Trophy size={16} />{game.prize}</span>}
          </div>
          <a className="rules-pdf-download" href={`/game-rules/${gameId}.pdf`} download={`PINKD-${game.id}-Rules.pdf`}><Download size={18} /> Download this game's PDF</a>
        </div>
        <section className="rules-instructions" aria-labelledby="how-to-play">
          <h2 id="how-to-play">How to play</h2>
          <GameRuleInstructions game={game} />
        </section>
        <footer className="rules-footer">
          <p>Play fair. The runner explains the format and decides disputes. No interference; respect consent. Alcohol is always optional, with a non-alcoholic alternative.</p>
          <p>Paid play starts after the runner confirms your coin payment. Once a game starts, its entry fee is non-refundable. Free games need no coin payment or NFC scan.</p>
          {game.prize?.includes("Pinkredible") && <p>Each Pinkredible gives Rs. 100 off course registration, not cash. Check your band on My coins.</p>}
          <p>Confirm the fee and local format with the runner before paying. Donations start at 150 whole coins. Party entry is 18+.</p>
          <Link to="/game-rules"><ArrowLeft size={15} /> All game rules</Link>
        </footer>
      </> : <div className="rules-heading">
        <h1>Game not found<span>.</span></h1>
        <p>This game link is not available.</p>
        <Link className="rules-pdf-download" to="/game-rules"><ArrowLeft size={18} /> View all games</Link>
      </div>}
    </div>
  </main>;
}
