export const gameRuleGroups = ["All games", "Tier 1", "Tier 2", "Tier 3", "Free", "Donations"] as const;
export type GameRuleGroup = (typeof gameRuleGroups)[number];

type GameRule = {
  id: string;
  name: string;
  group: Exclude<GameRuleGroup, "All games">;
  cost: string;
  outcome: string;
  prize?: string;
  rules: Array<string | { title: string; body: string }>;
  aliases?: string;
  note?: string;
};

// Paid-game steps follow the owner's September 9 handoff. Free games and
// donations retain the team SOP with the approved 150-coin minimum.
export const gameRules: GameRule[] = [
  {
    id: "shoot-your-shot", name: "Shoot Your Shot", group: "Tier 1", cost: "450 coins",
    outcome: "Your message is announced and the person accepts.",
    rules: [
      { title: "Write your shot", body: "Write your question or message on the chit. Choose your words wisely." },
      { title: "Name your target", body: "Clearly write the name of the person your message is intended for." },
      { title: "Own your shot", body: "Don't forget to write your own name on the chit too. Anonymous... for now." },
      { title: "Drop it in", body: "Fold your chit and put it into the designated Shoot Your Shot box." },
      { title: "The MC picks", body: "The MC randomly picks a chit and reads the question/message out loud on the microphone. Yep. In front of everyone." },
      { title: "Accept or decline?", body: "The intended person gets the choice: no pressure, no awkwardness. Their choice is final." },
      { title: "If they accept...", body: "The mystery is over! The name of the person who wrote the chit is revealed. Congratulations... YOU SHOT YOUR SHOT." },
    ],
    note: "If they decline, the writer stays anonymous. Offensive, discriminatory, threatening or sexually inappropriate messages may be rejected by the runner.",
  },
  {
    id: "spin-the-wheel", name: "Spin the Wheel", group: "Tier 1", cost: "450 coins",
    outcome: "The section beneath the pointer decides your result.",
    rules: [
      { title: "One spin. One shot.", body: "You get ONE spin of the wheel. Make it count!" },
      { title: "Start at the start", body: "The wheel must be spun from the designated starting position." },
      { title: "Let it stop!", body: "No stopping, nudging, touching or helping the wheel. Let it come to a complete and natural stop." },
      { title: "Where you land = what you get", body: "The section/number where the pointer lands determines your prize or result." },
      { title: "Tricky landing?", body: "If the pointer lands ambiguously between two sections, the Game Runner has the final call OR you may be given one re-spin, at the Game Runner's discretion!" },
      { title: "Instant result!", body: "Your result will be announced immediately after the spin." },
    ],
    note: "The wheel's outcomes must be marked before play and cannot change during the game. Ask the runner to confirm any reward before your spin.",
  },
  {
    id: "wing-person-for-hire", name: "Wing Person for Hire", group: "Tier 1", cost: "450 coins",
    outcome: "One introduction attempt, not a competitive prize.",
    rules: [
      { title: "Pick your Wingperson", body: "Choose the Wingperson you want on your side. Pick wisely. This is your teammate now." },
      { title: "Pick your person", body: "Tell the Game Runner who you'd like to be introduced to. Your mission has been assigned." },
      { title: "Let the Wingperson work", body: "Your hired Wingperson must make the introduction!" },
      { title: "Mission: introduce", body: "The game is successfully completed once the Wingperson has introduced you to the person you selected. What happens after the introduction? That's up to you." },
      { title: "No pressure", body: "The person being introduced to cannot be pressured, forced or made to continue the interaction. An introduction is the goal, not a guaranteed conversation or anything beyond that." },
      { title: "Wingperson commitment", body: "Once a Wingperson accepts the hire, they should complete the introduction unless there is a genuine reason they cannot. No disappearing acts." },
      { title: "One shot only", body: "One payment = one introduction attempt. Choose your target. Choose your Wingperson. Then... LET THEM COOK." },
    ],
  },
  {
    id: "hurdle", name: "Hurdle", group: "Tier 2", cost: "750 coins",
    outcome: "Fastest final time after penalties wins.", prize: "1 Pinkredible",
    rules: [
      { title: "Know the course", body: "The Game Runner will walk you through the entire course before you begin." },
      { title: "No cheat starts!", body: "No sneaky head starts! You move only after the Game Runner says GO!" },
      { title: "Follow the order", body: "Complete every challenge in the correct order. Skip something? Go back and finish it!" },
      { title: "Touch = penalty", body: "Touch a forbidden rope or cone? That's +7 seconds to your final time for each penalty." },
      { title: "Keep it balanced", body: "Drop the lemon? Restart that obstacle! No lemon, no glory." },
      { title: "Get dizzy", body: "Complete all 7 rounds around the cone without stopping or falling." },
      { title: "Hold that pose", body: "Strike the yoga pose and hold it for 10 full seconds." },
      { title: "Chug checkpoint", body: "Finish the specified quantity at the chug station as quickly as possible." },
      { title: "Your drink, your choice", body: "Don't drink alcohol? No stress! A non-alcoholic option will be available." },
      { title: "Show us the gains", body: "Complete 10 clean push-ups, approved by the Game Runner." },
      { title: "Runner rules", body: "The Game Runner has the final say on form, penalties and completion." },
    ],
  },
  {
    id: "cricket", name: "Cricket", group: "Tier 2", cost: "750 coins",
    outcome: "The team with the highest score wins.", prize: "1 Pinkredible",
    rules: [
      { title: "Pick your side", body: "Players are divided into two teams. Choose your batters wisely." },
      { title: "One innings. Make it count.", body: "Each team gets one short innings to put runs on the board. No second chances. No 'we'll get them next innings.'" },
      { title: "Limited balls", body: "Each player gets a predetermined number of balls. Every delivery counts. Make them count!" },
      { title: "Score those runs", body: "Runs are scored according to the agreed game rules. Swing big. Run fast. Rack up the runs!" },
      { title: "Wicket! You're out.", body: "A player can be dismissed by the agreed methods: bowled, caught or run out. Once you're out, you're out!" },
      { title: "Keep an eye on the score", body: "The Game Runner will keep track of the runs, wickets and valid deliveries throughout the game." },
      { title: "Tied game? Showdown!", body: "Both teams finished on the same score? Time for a ONE-BALL SHOWDOWN. One ball. One moment. One chance to win." },
      { title: "Game Runner = final call", body: "The Game Runner decides whether a delivery is legal, confirms the runs and records the official score. What the Game Runner says, goes!" },
    ],
  },
  {
    id: "issue-with-a-tissue", name: "Issue With a Tissue", group: "Tier 2", cost: "750 coins",
    outcome: "First team to complete a valid transfer through all five players.", prize: "1 Pinkredible",
    rules: [
      { title: "Build your team", body: "Two teams of 5 players line up and get ready for battle." },
      { title: "Start with the tissue", body: "The first player holds the tissue using only their mouth. Hands are officially out of the game." },
      { title: "Pass it on", body: "Transfer the tissue from your mouth to the next player's mouth without using your hands. Sounds easy. It isn't :)" },
      { title: "Keep it moving", body: "Continue passing the tissue down the line until all 5 team members have successfully received it." },
      { title: "Leave a little behind", body: "Here's the catch... After making their transfer, every player must have some piece or residue of the tissue remaining in their mouth. No evidence? No win!" },
      { title: "Dropped it? Big issue.", body: "If the tissue is dropped at any point, the entire team goes back to the beginning. START AGAIN FROM PLAYER ONE. No shortcuts. No mercy." },
    ],
    note: "This is a mouth-contact activity. Check hygiene and suitability with the runner before joining; do not swallow tissue or participate if uncomfortable.",
  },
  {
    id: "limbo", name: "Limbo", group: "Tier 3", cost: "1,000 coins",
    outcome: "Last participant remaining wins.", prize: "1 Pinkredible",
    rules: [
      { title: "Take the challenge", body: "At the beginning of your turn, take the designated drink/challenge and get ready for the bar." },
      { title: "Go under!", body: "Make your way underneath the limbo bar without touching it or falling." },
      { title: "It gets lower!", body: "Survived the round? Nice. The bar goes lower. And lower. And lower..." },
      { title: "Face up", body: "Your body must remain facing upward while passing underneath the bar." },
      { title: "No hands!", body: "Hands cannot be used to support yourself on the floor. You've got to trust the limbo skills!" },
      { title: "Touch it or drop it", body: "Touch the bar? Fall down? You're OUT!" },
    ],
    note: "The last person standing takes the crown and the Pinkredible! A non-alcoholic alternative is always available.",
  },
  {
    id: "bombastic", name: "Bombastic", group: "Tier 3", cost: "1,000 coins",
    outcome: "Last participant remaining wins.", prize: "1 Pinkredible + a shot",
    rules: [
      { title: "Get in line", body: "5 players. One line. One bomb. Good luck." },
      { title: "Start the countdown", body: "The Game Runner starts the timer, but keeps the duration a secret." },
      { title: "Copy. Add. Pass.", body: "Player 1 does a move. Player 2 repeats it and adds a new move. Player 3 repeats both and adds another. And so on... Once it reaches the end of the line, the sequence starts again from the other end." },
      { title: "Don't hold the bomb", body: "Keep it moving. Deliberately holding onto the bomb for too long = not cool." },
      { title: "Boom!", body: "When the timer goes off, whoever is holding the bomb is ELIMINATED. They take the agreed consequence, a shot, and leave the game." },
      { title: "Reset & repeat", body: "The timer resets. The bomb keeps moving. Repeat until only one person remains." },
    ],
    note: "Pass the bomb safely. No throwing it at people or deliberately stopping someone from catching it. Keep it fun. Keep it moving. A non-alcoholic alternative is always available.",
  },
  {
    id: "minute-to-win-it", name: "Minute to Minute", aliases: "Minute to Win It", group: "Tier 3", cost: "1,000 coins",
    outcome: "Solo: finish before time runs out. Group entry: fastest finisher wins.", prize: "1 Pinkredible",
    rules: [
      { title: "Ready, set, GO", body: "The timer starts when the Game Runner says GO!" },
      { title: "Roll the dice", body: "Roll the dice. 7 or more? You're in. 6 or less? Sorry, roll again." },
      { title: "Ball it up", body: "Get the ball from one end of the table to the opposite edge with exactly 7 taps." },
      { title: "Stack attack", body: "Your dice total = your cup count. Rolled an 8? Stack 8 cups. Easy math, right?" },
      { title: "Shot & flip", body: "Take your shot, then flip your cup and land it upside down." },
      { title: "Messed up? Do it again.", body: "Miss a stage? Repeat that stage until you nail it." },
      { title: "Beat the clock", body: "Complete the entire sequence before the timer runs out." },
      { title: "And the winner is...", body: "Anyone who completes all the stages within the timer wins a Pinkredible." },
      { title: "Group entry? Bring it on.", body: "Everyone can play, but only the fastest person takes home the Pinkredible." },
    ],
    note: "Listed as Minute to Win It at the payment desk. Confirm the dice setup and timer with the runner before play. The drink may be alcoholic only where legally and operationally permitted; a non-alcoholic alternative is always available.",
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
