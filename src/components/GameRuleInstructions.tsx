import { gameRules } from "@/data/gameRules";

export function GameRuleInstructions({ game }: { game: (typeof gameRules)[number] }) {
  return <>
    <ol>{game.rules.map((rule) => (
      <li key={typeof rule === "string" ? rule : rule.title}>
        {typeof rule === "string" ? rule : <><strong className="rules-step-title">{rule.title}</strong><p>{rule.body}</p></>}
      </li>
    ))}</ol>
    {game.note && <p className="rules-note">{game.note}</p>}
  </>;
}
