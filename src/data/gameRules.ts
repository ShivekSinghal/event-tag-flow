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

// Owner-supplied September 10 copy. These display rules do not configure POS rewards.
export const gameRules: GameRule[] = [
  {
    "id": "shoot-your-shot",
    "name": "Shoot Your Shot",
    "group": "Tier 1",
    "cost": "450 coins",
    "outcome": "Your message is announced and the person accepts.",
    "rules": [
      {
        "title": "WRITE YOUR SHOT",
        "body": "Write your question or message on the chit.\nChoose your words wisely."
      },
      {
        "title": "NAME YOUR TARGET",
        "body": "Clearly write the name of the person your message is intended for."
      },
      {
        "title": "OWN YOUR SHOT",
        "body": "Don't forget to write your own name on the chit too.\nAnonymous... for now."
      },
      {
        "title": "DROP IT IN",
        "body": "Fold your chit and put it into the designated Shoot Your Shot box."
      },
      {
        "title": "THE MC PICKS",
        "body": "The MC randomly picks a chit and reads the question/message out loud on the microphone.\nYep. In front of everyone."
      },
      {
        "title": "ACCEPT OR DECLINE?",
        "body": "The intended person gets the choice:\nNo pressure. No awkwardness. Their choice is final."
      },
      {
        "title": "IF THEY ACCEPT...",
        "body": "The mystery is over!\nThe name of the person who wrote the chit is revealed.\nCongratulations...\nYOU SHOT YOUR SHOT"
      }
    ]
  },
  {
    "id": "spin-the-wheel",
    "name": "Spin the Wheel",
    "group": "Tier 1",
    "cost": "450 coins",
    "outcome": "The section beneath the pointer decides your result.",
    "rules": [
      {
        "title": "One Spin. One Shot.",
        "body": "You get ONE spin of the wheel -make it count!"
      },
      {
        "title": "Start at the Start",
        "body": "The wheel must be spun from the designated starting position."
      },
      {
        "title": "Let It Stop!",
        "body": "No stopping, nudging, touching, or helping the wheel.\nLet it come to a complete and natural stop."
      },
      {
        "title": "Where You Land = What You Get",
        "body": "The section/number where the pointer lands determines your prize or result."
      },
      {
        "title": "Tricky Landing?",
        "body": "If the pointer lands ambiguously between two sections, the Game Runner has the final call OR you may be given one re-spin, at the Game Runner\u2019s discretion!"
      },
      {
        "title": "Instant Result!",
        "body": "Your result will be announced immediately after the spin."
      }
    ]
  },
  {
    "id": "wing-person-for-hire",
    "name": "Wingperson for Hire",
    "group": "Tier 1",
    "cost": "450 coins",
    "outcome": "One introduction attempt, not a competitive prize.",
    "rules": [
      {
        "title": "PICK YOUR WINGPERSON",
        "body": "Choose the Wingperson you want on your side.\nPick wisely. This is your teammate now."
      },
      {
        "title": "PICK YOUR PERSON",
        "body": "Tell the Game Runner who you'd like to be introduced to.\nFeel free to go through our Catalogue.\nYour mission has been assigned."
      },
      {
        "title": "CLAIM THE PINK BADGE \ud83e\ude77",
        "body": "Once you tell the Host who you're hiring as your Wingperson, you'll receive a Pink Badge.\nHand the badge to your Wingperson \u2014 badge delivered = mission officially activated! \ud83d\ude80"
      },
      {
        "title": "LET THE WINGPERSON WORK",
        "body": "Your hired Wingperson must make the introduction!\nTime to let them cook."
      },
      {
        "title": "MISSION: INTRODUCE",
        "body": "The game is successfully completed once the Wingperson has successfully introduced you to the person you selected.\nWhat happens after the introduction?\nThat's up to you. \ud83d\udc40m"
      },
      {
        "title": "NO PRESSURE",
        "body": "The person being introduced to cannot be pressured, forced, or made to continue the interaction.\nAn introduction is the goal \u2014 not a guaranteed conversation or anything beyond that."
      },
      {
        "title": "WINGPERSON COMMITMENT",
        "body": "Once a Wingperson accepts the hire, they should complete the introduction unless there is a genuine reason they cannot.\nNo disappearing acts. \ud83d\udc7b"
      },
      {
        "title": "ONE SHOT ONLY",
        "body": "One payment = one introduction attempt.\nChoose your target. Choose your Wingperson.\nThen...\nLET THEM COOK. \ud83d\udd25"
      }
    ],
    "aliases": "Wing Person for Hire"
  },
  {
    "id": "hurdle",
    "name": "Hurdle",
    "group": "Tier 2",
    "cost": "750 coins",
    "outcome": "Fastest final time after penalties wins.",
    "prize": "1 Pinkredible",
    "rules": [
      {
        "title": "KNOW THE COURSE",
        "body": "The Game Runner will walk you through the entire course before you begin."
      },
      {
        "title": "NO CHEAT STARTS!",
        "body": "No sneaky head starts! You move only after the Game Runner says \u201cGO!\u201d"
      },
      {
        "title": "FOLLOW THE ORDER",
        "body": "Complete every challenge in the correct order. Skip something? Go back and finish it!"
      },
      {
        "title": "TOUCH = PENALTY",
        "body": "Touch a forbidden rope or cone? That\u2019s +7 seconds to your final time for each penalty."
      },
      {
        "title": "KEEP IT BALANCED",
        "body": "Drop the lemon? Restart that obstacle! No lemon, no glory."
      },
      {
        "title": "GET DIZZY",
        "body": "Complete all 7 rounds around the cone without stopping or falling."
      },
      {
        "title": "HOLD THAT POSE",
        "body": "Strike the yoga pose and hold it for 10 full seconds."
      },
      {
        "title": "CHUG CHECKPOINT",
        "body": "Finish the specified quantity at the chug station as quickly as possible."
      },
      {
        "title": "YOUR DRINK, YOUR CHOICE",
        "body": "Don\u2019t drink alcohol? No stress! A non-alcoholic option will be available."
      },
      {
        "title": "SHOW US THE GAINS",
        "body": "Complete 10 clean push-ups, approved by the Game Runner."
      },
      {
        "title": "RUNNER RULES",
        "body": "The Game Runner has the final say on form, penalties and completion."
      },
      {
        "title": "WHO WINS?",
        "body": "Fastest final time after penalties = WINNER!"
      }
    ]
  },
  {
    "id": "cricket",
    "name": "Cricket",
    "group": "Tier 2",
    "cost": "750 coins",
    "outcome": "The team with the highest score wins.",
    "prize": "A beer each for the winning team",
    "rules": [
      {
        "title": "PICK YOUR SIDE",
        "body": "Players are divided into two teams.\nChoose your batters wisely."
      },
      {
        "title": "ONE INNINGS. MAKE IT COUNT.",
        "body": "Each team gets one short innings to put runs on the board.\nNo second chances. No \"we'll get them next innings.\""
      },
      {
        "title": "LIMITED BALLS",
        "body": "Each player gets a predetermined number of balls.\nEvery delivery counts. Make them count!"
      },
      {
        "title": "SCORE THOSE RUNS",
        "body": "Runs are scored according to the agreed game rules.\nSwing big. Run fast. Rack up the runs!"
      },
      {
        "title": "WICKET! YOU'RE OUT.",
        "body": "A player can be dismissed by the agreed methods:\n* Bowled\n* Caught\n* Run Out\nOnce you're out, you're out!"
      },
      {
        "title": "KEEP AN EYE ON THE SCORE",
        "body": "The Game Runner will keep track of the runs, wickets, and valid deliveries throughout the game."
      },
      {
        "title": "TIED GAME? SHOWDOWN!",
        "body": "Both teams finished on the same score?\nTime for a ONE-BALL SHOWDOWN.\nOne ball. One moment. One chance to win."
      },
      {
        "title": "GAME RUNNER = FINAL CALL",
        "body": "The Game Runner decides whether a delivery is legal, confirms the runs, and records the official score.\nWinning team gets a beer each\ud83d\udd25"
      }
    ]
  },
  {
    "id": "issue-with-a-tissue",
    "name": "Issue With a Tissue",
    "group": "Tier 2",
    "cost": "750 coins",
    "outcome": "First team to complete a valid transfer through all five players.",
    "prize": "1 Pinkredible",
    "rules": [
      {
        "title": "BUILD YOUR TEAM",
        "body": "Two teams of 5 players line up and get ready for battle."
      },
      {
        "title": "START WITH THE TISSUE",
        "body": "The first player holds the tissue using only their mouth.\nHands are officially out of the game. \ud83d\ude08"
      },
      {
        "title": "PASS IT ON",
        "body": "Transfer the tissue from your mouth to the next player's mouth without using your hands.\nSounds easy?\nIt isn't:)"
      },
      {
        "title": "KEEP IT MOVING",
        "body": "Continue passing the tissue down the line until all 5 team members have successfully received it."
      },
      {
        "title": "LEAVE A LITTLE BEHIND",
        "body": "Here's the catch...\nAfter making their transfer, every player must have some piece or residue of the tissue remaining in their mouth.\nNo evidence? No win!!"
      },
      {
        "title": "DROPPED IT? BIG ISSUE.",
        "body": "If the tissue is dropped at any point, the entire team goes back to the beginning.\nSTART. AGAIN. FROM. PLAYER ONE.\nNo shortcuts. No mercy"
      }
    ]
  },
  {
    "id": "limbo",
    "name": "Limbo",
    "group": "Tier 3",
    "cost": "1,000 coins",
    "outcome": "Last participant remaining wins.",
    "prize": "1 Pinkredible",
    "rules": [
      {
        "title": "TAKE THE CHALLENGE",
        "body": "At the beginning of your turn, take the designated drink/challenge and get ready for the bar."
      },
      {
        "title": "GO UNDER!",
        "body": "Make your way underneath the limbo bar without touching it or falling."
      },
      {
        "title": "IT GETS LOWER!",
        "body": "Survived the round? Nice.\nThe bar goes lower. And lower. And lower... \ud83d\ude08"
      },
      {
        "title": "FACE UP",
        "body": "Your body must remain facing upward while passing underneath the bar."
      },
      {
        "title": "NO HANDS!",
        "body": "Hands cannot be used to support yourself on the floor.\nYou've got to trust the limbo skills!"
      },
      {
        "title": "TOUCH IT OR DROP IT",
        "body": "Touch the bar?\nFall down?\nYou're OUT!"
      },
      {
        "title": "THE WINNER",
        "body": "The last person standing takes the crown \u2014 and the Pinkredible!"
      }
    ]
  },
  {
    "id": "bombastic",
    "name": "Bombastic",
    "group": "Tier 3",
    "cost": "1,000 coins",
    "outcome": "Last person standing takes the win and the shot!",
    "prize": "A shot",
    "rules": [
      {
        "title": "GET IN LINE",
        "body": "5 players. One line. One bomb. Good luck."
      },
      {
        "title": "START THE COUNTDOWN",
        "body": "The Game Runner starts the timer \u2014 but keeps the duration a secret."
      },
      {
        "title": "COPY. ADD. PASS.",
        "body": "Player 1 does a move.\nPlayer 2 repeats it and adds a new move.\nPlayer 3 repeats both and adds another.\nAnd so on...\n\nOnce it reaches the end of the line, the sequence starts again from the other end."
      },
      {
        "title": "DON\u2019T HOLD THE BOMB",
        "body": "Keep it moving. Deliberately holding onto the bomb for too long = not cool."
      },
      {
        "title": "BOOM!",
        "body": "When the timer goes off, whoever is holding the bomb is ELIMINATED."
      },
      {
        "title": "RESET & REPEAT",
        "body": "The timer resets.\nThe bomb keeps moving.\nRepeat until only one person remains."
      },
      {
        "title": "WINNER",
        "body": "Last person standing takes the win and the shot!"
      },
      {
        "title": "IMPORTANT",
        "body": "Pass the bomb safely.\nNo throwing it at people. No deliberately stopping someone from catching it.\nKeep it fun. Keep it moving."
      }
    ]
  },
  {
    "id": "minute-to-win-it",
    "name": "Minute to Minute",
    "aliases": "Minute to Win It",
    "group": "Tier 3",
    "cost": "1,000 coins",
    "outcome": "Solo: finish before time runs out. Group entry: fastest finisher wins.",
    "prize": "1 Pinkredible",
    "rules": [
      {
        "title": "READY, SET, GO",
        "body": "The timer starts when the Game Runner says GO!"
      },
      {
        "title": "ROLL THE DICE",
        "body": "Roll the die.\n7 or more? You\u2019re in.\n6 or less? Sorry, roll again."
      },
      {
        "title": "BALL IT UP",
        "body": "Get the ball from one end of the table to the opposite edge with exactly 7 taps."
      },
      {
        "title": "STACK ATTACK",
        "body": "Your dice total = your cup count.\nRolled an 8? Stack 8 cups. Easy math, right?"
      },
      {
        "title": "SHOT & FLIP",
        "body": "Take your shot, then flip your cup and land it upside down."
      },
      {
        "title": "MESSED UP? DO IT AGAIN.",
        "body": "Miss a stage? Repeat that stage until you nail it."
      },
      {
        "title": "BEAT THE CLOCK",
        "body": "Complete the entire sequence before the timer runs out."
      },
      {
        "title": "AND THE WINNER IS...",
        "body": "Anyone who completes all the stages within the timer wins a PINKREDIBLE."
      },
      {
        "title": "GROUP ENTRY? BRING IT ON.",
        "body": "Everyone can play, but only the fastest person takes home the Pinkredible."
      },
      {
        "title": "THE DRINK BIT",
        "body": "The drink component may be alcoholic only where legally and operationally permitted. A non-alcoholic alternative will always be available."
      }
    ]
  },
  {
    "id": "red-flag-green-flag",
    "name": "Red Flag Green Flag",
    "group": "Free",
    "cost": "Free",
    "outcome": "The person furthest forward is the Red Flag.",
    "rules": [
      {
        "title": "START WITH A CLEAN SLATE",
        "body": "Everyone starts together behind the starting line.\nFor now, you\u2019re all innocent. \ud83d\udc40"
      },
      {
        "title": "HERE COMES THE QUESTION...",
        "body": "The Game Runner will ask a Red Flag question.\nListen carefully. Your reputation is on the line."
      },
      {
        "title": "STEP FORWARD IF IT'S YOU",
        "body": "If the question applies to you, step forward.\nYes, that means admitting it publicly.\nNo, your friends cannot save you.!!"
      },
      {
        "title": "NO LYING YOUR WAY OUT",
        "body": "Participants must answer honestly."
      },
      {
        "title": "HANDS OFF!",
        "body": "No pushing, pulling, dragging or moving someone else forward.\nLet their red flags speak for themselves."
      },
      {
        "title": "\ud83d\udc51 THE RUNNER IS WATCHING",
        "body": "The Game Runner controls the pace and decides who has officially moved forward.\nIf they saw you move\u2026\nYOU MOVED."
      },
      {
        "title": "ROUND AFTER ROUND",
        "body": "The questions keep coming for the predetermined number of rounds.\nEvery question could send you one step closer to becoming..."
      },
      {
        "title": "\ud83d\udea9 THE ULTIMATE RED FLAG \ud83d\udea9",
        "body": "The person who has travelled the furthest is officially crowned"
      }
    ]
  },
  {
    "id": "jamaal-challenge",
    "name": "Jamal Challenge",
    "group": "Free",
    "cost": "Free",
    "outcome": "Dance for the full song or agreed duration without dropping the drink.",
    "rules": [
      {
        "title": "HEADS UP!",
        "body": "Before the music starts, place the drink securely on your head"
      },
      {
        "title": "LET THE MUSIC TAKE OVER",
        "body": "Once the music begins, dance to the song while keeping the drink balanced.\nGo wild. Just don\u2019t go sideways."
      },
      {
        "title": "HANDS OFF!",
        "body": "You can use your hands to dance, pose, wave, or show off\u2026\nBut you cannot hold or support the drink."
      },
      {
        "title": "DROP IT = YOU\u2019RE OUT",
        "body": "If the drink falls off your head, you\u2019re eliminated!"
      },
      {
        "title": "NO SNEAKY SAVES",
        "body": "Caught deliberately holding or supporting the drink to stop it from falling?\nELIMINATED."
      },
      {
        "title": "THE RUNNER IS WATCHING",
        "body": "The Game Runner has the final say on whether a player has broken the rules."
      },
      {
        "title": "DANCE TO THE END",
        "body": "Keep dancing and keep that drink balanced for the entire predetermined song/duration."
      },
      {
        "title": "\ud83d\udc51 THE LAST DANCER STANDING!",
        "body": "The participant who survives the entire song while keeping the drink on their head wins the Pinkredible!"
      }
    ],
    "aliases": "Jamaal Challenge",
    "prize": "1 Pinkredible"
  },
  {
    "id": "squid-games",
    "name": "Squid Games",
    "group": "Free",
    "cost": "Free",
    "outcome": "Reach the finish line first without being eliminated.",
    "rules": [
      {
        "title": "TAKE YOUR POSITION",
        "body": "Everyone lines up behind the starting line.\nOnce the game begins, there\u2019s no turning back!"
      },
      {
        "title": "GREEN LIGHT = GO!",
        "body": "When the Game Runner calls \u201cGREEN LIGHT!\u201d, move forward as fast as you dare."
      },
      {
        "title": "RED LIGHT = FREEZE!",
        "body": "When you hear \u201cRED LIGHT!\u201d, STOP immediately.\nNo moving. No sneaky steps. No last-second shuffle. \ud83d\udc40"
      },
      {
        "title": "THE RUNNER IS WATCHING",
        "body": "The Game Runner will watch closely for anyone still moving after RED LIGHT.\nCaught moving? You\u2019re eliminated!"
      },
      {
        "title": "EXPECT THE UNEXPECTED",
        "body": "The Game Runner can change the timing between calls to keep everyone guessing.\nThink you know when RED LIGHT is coming?\nThink again."
      },
      {
        "title": "PLAY FAIR",
        "body": "No pushing, blocking, tripping, or physically interfering with another player.\nYour only weapon is speed\u2026 and self-control. \ud83e\udee1"
      },
      {
        "title": "MAKE IT TO THE END",
        "body": "Keep moving during GREEN LIGHT and freezing during RED LIGHT until someone reaches the finish line.\n\nThe first person to reach the finish line without being eliminated wins the Pinkredible"
      }
    ],
    "prize": "1 Pinkredible"
  },
  {
    "id": "beer-pong",
    "name": "Beer Pong",
    "group": "Free",
    "cost": "Free",
    "outcome": "Remove all the opposing team's cups first.",
    "rules": [
      {
        "title": "PICK YOUR STARTER",
        "body": "Teams decide who gets to throw first. Choose wisely pressure is real. \ud83d\ude08"
      },
      {
        "title": "TAKE YOUR SHOT",
        "body": "Players take turns throwing or bouncing the ball toward the opposing team\u2019s cups."
      },
      {
        "title": "SINK IT = REMOVE IT",
        "body": "Ball lands successfully in a cup? That cup is out!"
      },
      {
        "title": "CUP = DRINK RULE",
        "body": "The opposing team follows the agreed drinking rule for that cup."
      },
      {
        "title": "NO CUP COMEBACKS",
        "body": "Once a cup is removed, it stays out. No second chances!"
      },
      {
        "title": "STAY BEHIND THE LINE",
        "body": "Players must keep behind the designated throwing line when taking their shot."
      },
      {
        "title": "NO FUNNY BUSINESS",
        "body": "No distracting, blocking, touching, or interfering with another team\u2019s throw."
      },
      {
        "title": "ELIMINATE THEM ALL",
        "body": "Keep playing until one team has successfully eliminated every opposing cup."
      },
      {
        "title": "WHO WINS?",
        "body": "No cups left = No competition.\nThe first team to eliminate all of the opposing team\u2019s cups wins the Pinkredible! \ud83c\udfc6"
      },
      {
        "title": "DRINK RESPONSIBLY",
        "body": "Drinking is optional. Nobody should ever feel pressured to consume alcohol.\nA non-alcoholic alternative can be used for anyone who prefers not to drink!\n\nMAY YOUR AIM BE TRUE!"
      }
    ],
    "prize": "1 Pinkredible"
  },
  {
    "id": "karaoke",
    "name": "Karaoke",
    "group": "Donations",
    "cost": "150+ coins",
    "outcome": "An open Karaoke fundraiser: music, madness and money raised for a good cause.",
    "rules": [
      {
        "title": "PICK YOUR JAM",
        "body": "Choose one song from the available Karaoke selection.\nPick wisely - you only get one shot at that song!"
      },
      {
        "title": "ONE SLOT. ONE SHOW.",
        "body": "Each participant or group gets one performance slot.\nMake it count!"
      },
      {
        "title": "QUEUE UP!",
        "body": "The Game Runner controls the performance queue.\nYour name will be called when it\u2019s your time to shine."
      },
      {
        "title": "KEEP IT CLEAN",
        "body": "No inappropriate, abusive, or offensive songs or content.\nBring the vibes, not the drama!"
      },
      {
        "title": "JUST SINGING FOR A CAUSE?",
        "body": "This is an open Karaoke fundraiser!\nJust music, madness and money raised for a good cause"
      },
      {
        "title": "THE REAL WINNER",
        "body": "There\u2019s no better feeling than knowing your performance helped raise money for a good cause. \ud83d\udc97"
      }
    ]
  },
  {
    "id": "busk-for-a-cause",
    "name": "Busk for a Cause",
    "group": "Donations",
    "cost": "Donations 150+ coins",
    "outcome": "Perform for the fundraiser; the audience can donate.",
    "rules": [
      {
        "title": "YOUR TIME TO SHINE",
        "body": "You\u2019ll be given a set performance time."
      },
      {
        "title": "WAIT YOUR TURN",
        "body": "The Game Runner will decide the performance order.\nYour slot is coming\u2026 be ready!"
      },
      {
        "title": "OWN THE STAGE",
        "body": "Sing. Dance. Rap. Perform. Entertain.\nWhatever your talent, give the audience a show!"
      },
      {
        "title": "LET THE AUDIENCE DECIDE",
        "body": "If they love what they see, audience members can donate Pink Coins towards the fundraiser.\nMore applause = potentially more coins! \ud83d\udc97"
      },
      {
        "title": "COINS GO THROUGH THE OFFICIAL CHANNEL",
        "body": "All donations must be made through the designated donation mechanism.\nNo unofficial collections!"
      },
      {
        "title": "TIME'S UP!",
        "body": "When your performance time ends, take your final bow and make way for the next performer."
      },
      {
        "title": "THE REAL WINNER",
        "body": "There\u2019s no better feeling than knowing your performance helped raise money for a good cause. \ud83d\udc97"
      }
    ]
  }
];
