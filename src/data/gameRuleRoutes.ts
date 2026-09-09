// Printed QR codes depend on these identifiers. Never renumber existing games.
export const gameRuleRouteIds: Record<string, string> = {
  "shoot-your-shot": "game1",
  "spin-the-wheel": "game2",
  "wing-person-for-hire": "game3",
  hurdle: "game4",
  cricket: "game5",
  "issue-with-a-tissue": "game6",
  limbo: "game7",
  bombastic: "game8",
  "minute-to-win-it": "game9",
  "red-flag-green-flag": "game10",
  "jamaal-challenge": "game11",
  "squid-games": "game12",
  "beer-pong": "game13",
  karaoke: "game14",
  "busk-for-a-cause": "game15",
};

export const gameRulePath = (id: string) => `/games-rules/${gameRuleRouteIds[id]}`;
