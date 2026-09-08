export const gameRuleGroups = ["All games", "Tier 1", "Tier 2", "Tier 3", "Free", "Donations"] as const;
export type GameRuleGroup = (typeof gameRuleGroups)[number];

type GameRule = {
  id: string;
  name: string;
  group: Exclude<GameRuleGroup, "All games">;
  cost: string;
  outcome: string;
  prize?: string;
  rules: string[];
  note?: string;
};

// Team SOP, September 5; Bombastic update September 6; Minute to Win It
// update September 8; wheel prompts September 9. Donation minimum follows
// the owner's later approved 150-coin configuration, not the older SOP.
export const gameRules: GameRule[] = [
  {
    id: "shoot-your-shot", name: "Shoot Your Shot", group: "Tier 1", cost: "450 coins",
    outcome: "Your message is announced and the person accepts.",
    rules: [
      "After payment is confirmed, write your message, your name and the intended person's name on a chit.",
      "Fold the chit and put it in the designated box. The MC picks chits at random and reads the message aloud.",
      "The intended person may accept or decline. Your name is revealed only if they accept; otherwise it stays anonymous.",
      "Nobody may be pressured to accept. Offensive, discriminatory, threatening or sexually inappropriate messages can be rejected before announcement.",
    ],
  },
  {
    id: "spin-the-wheel", name: "Spin the Wheel", group: "Tier 1", cost: "450 coins",
    outcome: "The section beneath the pointer decides your result.",
    rules: [
      "Once payment is confirmed, take one spin from the designated starting position and let the wheel stop completely.",
      "The runner announces the result. If the pointer sits between sections, the runner decides or allows one re-spin.",
      "Lucky or Unlucky: spin again; the second result is final. A Free Shot: claim your shot at the bar. Better Luck Next Time: no prize on this spin.",
      "Dance with Your Dreamcatcher: dance together for one song. Be the Host: take the microphone for the next five minutes.",
      "Shoot Your Shot: register at the chit desk for your secured entry. Selfie Challenge: take a selfie with Astha or Dhriti and post it on Instagram.",
      "Wild Card - Karaoke: register your song; it moves to the top of the queue.",
    ],
    note: "The wheel's outcomes must be marked before play and cannot change during the game. Ask the runner to confirm any reward before your spin.",
  },
  {
    id: "wing-person-for-hire", name: "Wing Person for Hire", group: "Tier 1", cost: "450 coins",
    outcome: "One introduction attempt, not a competitive prize.",
    rules: [
      "Choose the Wingperson you want to hire and the person you would like to meet.",
      "After payment is confirmed, the Wingperson makes the introduction in their own entertaining way.",
      "One payment covers one introduction attempt. The other person is never obliged to continue the interaction.",
      "The activity is complete when the introduction happens. A Wingperson should not refuse an accepted hire without a genuine reason.",
    ],
  },
  {
    id: "hurdle", name: "Hurdle", group: "Tier 2", cost: "750 coins",
    outcome: "Fastest valid completion of the full course.", prize: "1 Pinkredible",
    rules: [
      "The runner explains the course, penalties, drink quantity and time requirements before you start. Wait for GO.",
      "Complete the cone/ball obstacle, ball throw into a ring, rope clearance, drink station and 10 push-ups in the specified order.",
      "Repeat any missed obstacle. Prohibited contact with ropes or cones means a penalty or repeat, as explained by the runner.",
      "Balls must land inside the ring. All 10 push-ups must meet the runner's stated form standard.",
      "The fastest correctly completed course wins. A non-alcoholic option must be available at the drink station.",
    ],
  },
  {
    id: "cricket", name: "Cricket", group: "Tier 2", cost: "750 coins",
    outcome: "The team with the highest score wins.", prize: "1 Pinkredible",
    rules: [
      "Split into two teams. Each team has one short innings, with the number of balls per player agreed before play.",
      "Score runs normally. Agreed dismissals are bowled, caught and run out.",
      "The runner records the score and decides whether a ball is legal.",
      "Highest score wins. A tie goes to a one-ball / sudden-death round.",
    ],
  },
  {
    id: "issue-with-a-tissue", name: "Issue With a Tissue", group: "Tier 2", cost: "750 coins",
    outcome: "First team to complete a valid transfer through all five players.", prize: "1 Pinkredible",
    rules: [
      "Two teams of five line up, with one tissue per team.",
      "The first player holds the tissue with their mouth and passes it to the next player's mouth without using hands.",
      "Continue along the line. Under the team's SOP, each player must retain a small piece after their transfer.",
      "If the tissue drops, restart from the first player. The first team to complete the full transfer correctly wins.",
    ],
    note: "This is a mouth-contact activity. Check hygiene and suitability with the runner before joining; do not swallow tissue or participate if uncomfortable.",
  },
  {
    id: "limbo", name: "Limbo", group: "Tier 3", cost: "1,000 coins",
    outcome: "Last participant remaining wins.", prize: "1 Pinkredible",
    rules: [
      "Complete the designated drink or challenge at the beginning of your turn. A non-alcoholic alternative must be available.",
      "Pass under the bar facing upward without touching it, falling or supporting yourself with your hands on the floor.",
      "The bar is lowered after each successful round. Touching the bar or falling means elimination.",
      "Continue until one participant remains.",
    ],
  },
  {
    id: "bombastic", name: "Bombastic", group: "Tier 3", cost: "1,000 coins",
    outcome: "Last participant remaining wins.", prize: "1 Pinkredible + a shot",
    rules: [
      "Form a circle. The runner starts a hidden timer while a squeaky 'time bomb' ball is passed from person to person.",
      "Do not deliberately hold the ball for excessive time. Pass safely; do not throw it at someone or prevent a catch.",
      "When the timer sounds, the person holding the ball is eliminated and leaves the circle after the agreed drink consequence.",
      "Reset the timer and repeat until one person remains. The winner also receives a shot, with a non-alcoholic alternative available.",
    ],
  },
  {
    id: "minute-to-win-it", name: "Minute to Win It", group: "Tier 3", cost: "1,000 coins",
    outcome: "Complete every stage before the timer expires.", prize: "1 Pinkredible",
    rules: [
      "Confirm the allotted time and dice setup with the runner before starting. The timer begins on GO.",
      "Roll the dice until the sum is 7 or more.",
      "Pass the ball to the opposite edge of the table with 7 ball taps, then stack 7 cups.",
      "Complete the drink, then flip the cup so it lands upside down. A non-alcoholic alternative must be available.",
      "Repeat any stage you fail. Complete the entire sequence before time runs out to win a Pinkredible.",
    ],
    note: "Sequence: roll dice, 7 ball taps, stack 7 cups, drink, flip the cup.",
  },
  {
    id: "red-flag-green-flag", name: "Red Flag Green Flag", group: "Free", cost: "Free",
    outcome: "The person furthest forward is the Red Flag.",
    rules: [
      "Start at the same line. The MC holds the Red Flag / Green Flag paddle and asks a series of Red Flag questions.",
      "Step forward honestly when a statement applies to you. Do not push or move anyone else.",
      "The MC controls the pace and number of questions. At the end, the person furthest forward is the Red Flag.",
      "The Red Flag buys the Green Flag a mutually agreed drink. Nobody is required to consume alcohol.",
    ],
  },
  {
    id: "jamaal-challenge", name: "Jamaal Challenge", group: "Free", cost: "Free",
    outcome: "Dance for the full song or agreed duration without dropping the drink.",
    rules: [
      "Balance a drink/container securely on your head before the music starts. Everyone dances to the same song.",
      "Dance while keeping it balanced. You can move your hands, but cannot hold or support the drink.",
      "Dropping the drink or deliberately holding it to prevent a fall means elimination.",
      "The runner judges rule breaches. Complete the full duration with the drink balanced to win.",
    ],
  },
  {
    id: "squid-games", name: "Squid Games", group: "Free", cost: "Free",
    outcome: "Reach the finish line first without being eliminated.",
    rules: [
      "The SOP's suggested format is Red Light, Green Light; confirm the day's format with the runner.",
      "Line up behind the start. Move forward on GREEN LIGHT and freeze immediately on RED LIGHT.",
      "Moving after RED LIGHT means elimination. The runner may vary the timing.",
      "No pushing, blocking or interfering with others. First to reach the finish without elimination wins.",
    ],
  },
  {
    id: "beer-pong", name: "Beer Pong", group: "Free", cost: "Free",
    outcome: "Remove all the opposing team's cups first.",
    rules: [
      "Form two teams, normally two players each. Set equal numbers of cups at opposite ends with equal balls per team.",
      "Agree who starts and take turns throwing or bouncing a ball into the opposing cups from behind the throwing line.",
      "A ball landing in a cup removes that cup permanently. Follow the agreed optional drinking rule for that cup.",
      "Do not distract, block or interfere with throws. The first team to remove all opposing cups wins.",
    ],
    note: "Players provide their own drinks. Alcohol is optional; use a non-alcoholic alternative. Free games do not award Pinkredibles.",
  },
  {
    id: "karaoke", name: "Karaoke", group: "Donations", cost: "150+ coins",
    outcome: "One performance slot, with judging only if announced.",
    rules: [
      "Donate at least 150 whole Pink Coins through the runner before taking the microphone.",
      "Choose a song from the available selection. Each participant or group receives one performance slot.",
      "Respect the queue and allotted time. No abusive, offensive or inappropriate content.",
      "If judging is included, criteria must be announced before performances. An open fundraiser does not need a winner.",
    ],
  },
  {
    id: "busk-for-a-cause", name: "Busk for a Cause", group: "Donations", cost: "Donations 150+ coins",
    outcome: "Perform for the fundraiser; the audience can donate.",
    rules: [
      "Performing is free under the team's SOP. Register with the runner for an allotted time and place in the performance order.",
      "Sing, dance, play an instrument, perform comedy or beatbox for the audience.",
      "Audience donations are voluntary. Each coin donation is at least 150 whole coins and goes through the designated runner's donation flow.",
      "Do not pressure individual attendees to donate. Finish on time so the next performer can take their slot.",
    ],
  },
];
