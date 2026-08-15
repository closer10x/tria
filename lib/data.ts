import { Email, Task, Thread } from "./types";

export const seedEmails: Email[] = [
  {
    id: "e1",
    from: {
      name: "Maya Chen",
      email: "maya@brightlane.co",
      initials: "MC",
      hue: "bg-rose-100 text-rose-700",
    },
    subject: "Q3 launch assets — final review by Friday",
    preview:
      "Hey Jon — the landing page copy and the two hero variants are ready for your review…",
    body: [
      "Hey Jon,",
      "The landing page copy and the two hero variants are ready for your review. We need sign-off by Friday EOD to stay on schedule for the Q3 launch.",
      "Three things we need from you: approve the hero variant (A or B), confirm the pricing table copy, and send over the customer logos we're cleared to use.",
      "If anything feels off, grab 15 minutes on my calendar and we'll sort it live.",
      "— Maya",
    ],
    time: "9:41 AM",
    read: false,
    folder: "inbox",
    tag: "Launch",
    attachments: [
      { name: "hero-variant-A.png", size: "1.2 MB" },
      { name: "hero-variant-B.png", size: "1.4 MB" },
      { name: "pricing-table.pdf", size: "240 KB" },
    ],
  },
  {
    id: "e2",
    from: {
      name: "Derek Okafor",
      email: "derek@northpine.io",
      initials: "DO",
      hue: "bg-sky-100 text-sky-700",
    },
    subject: "Invoice #2041 — payment terms question",
    preview:
      "Quick one — our finance team is asking if we can move to net-45 on the retainer…",
    body: [
      "Jon,",
      "Quick one — our finance team is asking if we can move to net-45 on the retainer starting next cycle. Everything else stays the same.",
      "If that works, I'll have the amended agreement over to you today. Happy to hop on a call if it's easier.",
      "Best,",
      "Derek",
    ],
    time: "8:56 AM",
    read: false,
    folder: "inbox",
    tag: "Billing",
  },
  {
    id: "e3",
    from: {
      name: "Priya Nair",
      email: "priya@atlasgrid.com",
      initials: "PN",
      hue: "bg-violet-100 text-violet-700",
    },
    subject: "Onboarding call recap + next steps",
    preview:
      "Great call today! Recapping what we agreed on: kickoff doc, sandbox access, and the data import…",
    body: [
      "Hi Jon,",
      "Great call today! Recapping what we agreed on:",
      "1. You'll share the kickoff doc by Wednesday. 2. We'll provision sandbox access for your team. 3. Data import scheduled for next Monday.",
      "Let me know if I missed anything. Excited to get moving!",
      "Priya",
    ],
    time: "Yesterday",
    read: true,
    folder: "inbox",
    tag: "Client",
  },
  {
    id: "e4",
    from: {
      name: "Sam Whitfield",
      email: "sam@ferrostudio.com",
      initials: "SW",
      hue: "bg-emerald-100 text-emerald-700",
    },
    subject: "Site redesign — round 2 feedback due",
    preview:
      "Round 2 mockups are in the shared folder. We'd love consolidated feedback by Tuesday…",
    body: [
      "Hey Jon,",
      "Round 2 mockups are in the shared folder. We'd love consolidated feedback by Tuesday so we can lock the design system before dev starts.",
      "Main open questions: the nav structure, and whether the case studies live on their own page or the homepage.",
      "Cheers,",
      "Sam",
    ],
    time: "Yesterday",
    read: true,
    folder: "inbox",
    tag: "Design",
    attachments: [{ name: "round2-mockups.pdf", size: "3.1 MB" }],
  },
  {
    id: "e5",
    from: {
      name: "Linnea Park",
      email: "linnea@hearthandco.com",
      initials: "LP",
      hue: "bg-amber-100 text-amber-700",
    },
    subject: "Speaking slot at Founder Forum — Oct 12",
    preview:
      "We'd love to have you on the 'Building Lean' panel. 25 minutes, moderated, ~300 attendees…",
    body: [
      "Hi Jon,",
      "We'd love to have you on the 'Building Lean' panel at Founder Forum on Oct 12. 25 minutes, moderated, around 300 attendees.",
      "If you're in, I'll need a short bio and headshot by end of month.",
      "Warmly,",
      "Linnea",
    ],
    time: "Tue",
    read: true,
    folder: "inbox",
    tag: "Events",
  },
  {
    id: "e6",
    from: {
      name: "Noah Reyes",
      email: "noah@vantagelegal.com",
      initials: "NR",
      hue: "bg-indigo-100 text-indigo-700",
    },
    subject: "MSA redlines — one clause left",
    preview:
      "Attached the redlined MSA. Only open item is the liability cap in §7 — flagged for you…",
    body: [
      "Jon,",
      "Attached the redlined MSA. Only open item is the liability cap in §7 — I've flagged it for you.",
      "If you're fine with 12 months of fees, we can sign this week.",
      "Noah",
    ],
    time: "7:12 AM",
    read: false,
    folder: "inbox",
    starred: true,
    tag: "Legal",
    attachments: [{ name: "MSA-redline-v4.pdf", size: "890 KB" }],
  },
  {
    id: "e7",
    from: {
      name: "Ava Kim",
      email: "ava@copperfin.co",
      initials: "AK",
      hue: "bg-emerald-100 text-emerald-700",
    },
    subject: "September budget draft + runway model",
    preview:
      "Budget draft attached. Runway lands at 19 months in the base case — notes in the sheet…",
    body: [
      "Hi Jon,",
      "Budget draft attached. Runway lands at 19 months in the base case — notes are in the sheet.",
      "Two calls to make: the contractor line and whether we push the offsite to Q1.",
      "Ava",
    ],
    time: "Yesterday",
    read: false,
    folder: "inbox",
    tag: "Finance",
    attachments: [
      { name: "sept-budget-draft.xlsx", size: "310 KB" },
      { name: "runway-model.xlsx", size: "540 KB" },
    ],
  },
  {
    id: "e8",
    from: {
      name: "Foundry Weekly",
      email: "digest@foundryweekly.com",
      initials: "FW",
      hue: "bg-sky-100 text-sky-700",
    },
    subject: "Issue #142 — pricing pages that convert",
    preview: "This week: teardown of 8 pricing pages, plus a founder Q&A…",
    body: [
      "This week: teardown of 8 pricing pages, plus a founder Q&A on usage-based pricing.",
    ],
    time: "Wed",
    read: true,
    folder: "archive",
    tag: "Newsletter",
  },
  {
    id: "e9",
    from: {
      name: "Milo Grant",
      email: "milo@stackpilot.io",
      initials: "MG",
      hue: "bg-amber-100 text-amber-700",
    },
    subject: "Quick demo of StackPilot for your team?",
    preview: "Saw what you're building — 15 minutes this week to show you StackPilot?",
    body: [
      "Hey Jon — saw what you're building. 15 minutes this week to show you StackPilot?",
    ],
    time: "Tue",
    read: true,
    folder: "snoozed",
    snoozedUntil: "Mon, 8 AM",
    tag: "Sales",
  },
  {
    id: "e10",
    from: {
      name: "DealFlow Pro",
      email: "no-reply@dealflow-pro.biz",
      initials: "DP",
      hue: "bg-rose-100 text-rose-700",
    },
    subject: "🔥 LAST CHANCE: 500 leads for $9",
    preview: "Unlock 500 verified leads today only…",
    body: ["Unlock 500 verified leads today only. Don't miss out!!!"],
    time: "Mon",
    read: true,
    folder: "trash",
    tag: "Spam",
  },
  {
    id: "e11",
    from: {
      name: "Jon Garcia",
      email: "jon.garcia.a@gmail.com",
      initials: "JG",
      hue: "bg-(--color-clay-soft) text-(--color-clay)",
    },
    to: "priya@atlasgrid.com",
    subject: "Re: Onboarding call recap + next steps",
    preview: "Perfect recap — kickoff doc is in motion, you'll have it Wednesday…",
    body: [
      "Perfect recap — kickoff doc is in motion, you'll have it Wednesday.",
      "— Jon",
    ],
    time: "Yesterday",
    read: true,
    folder: "sent",
  },
];

export const seedTasks: Task[] = [
  {
    id: "t1",
    title: "Send kickoff doc to Atlas Grid",
    note: "Priya needs it by Wednesday to keep the data import on schedule.",
    sourceEmailId: "e3",
    priority: "high",
    due: "Wed, Aug 19",
    status: "doing",
    checklist: [
      { id: "c1", label: "Draft scope section", done: true },
      { id: "c2", label: "Add timeline + owners", done: false },
      { id: "c3", label: "Share with Priya", done: false },
    ],
    createdAt: "Yesterday",
  },
  {
    id: "t2",
    title: "Consolidate round 2 design feedback",
    note: "Nav structure + where case studies live. Ferro needs it Tuesday.",
    sourceEmailId: "e4",
    priority: "medium",
    due: "Tue, Aug 18",
    status: "todo",
    checklist: [
      { id: "c4", label: "Review mockups in shared folder", done: false },
      { id: "c5", label: "Collect team comments", done: false },
    ],
    createdAt: "Yesterday",
  },
];

export const seedThreads: Thread[] = [
  {
    id: "th1",
    name: "Launch crew",
    members: ["Maya", "Alex", "You"],
    emoji: "🚀",
    messages: [
      {
        id: "m1",
        author: "Maya",
        text: "Hero variant B is testing better in the preview group, fyi.",
        time: "9:12 AM",
      },
      {
        id: "m2",
        author: "Alex",
        text: "Agreed. B feels cleaner. Waiting on Jon for the final call.",
        time: "9:15 AM",
      },
      {
        id: "m2b",
        author: "Maya",
        text: "Final export of B, in case you want a closer look:",
        time: "9:18 AM",
        attachment: {
          type: "file",
          files: [{ name: "hero-B-final.png", size: "1.6 MB" }],
        },
      },
    ],
  },
  {
    id: "th2",
    name: "Atlas Grid onboarding",
    members: ["Priya", "You"],
    emoji: "🧭",
    messages: [
      {
        id: "m3",
        author: "Priya",
        text: "Sandbox access is live for your whole team ✨",
        time: "Yesterday",
      },
    ],
  },
  {
    id: "th3",
    name: "Ops + Billing",
    members: ["Dana", "You"],
    emoji: "🧾",
    messages: [
      {
        id: "m4",
        author: "Dana",
        text: "Flagging: two invoices land next week. I'll prep both Monday.",
        time: "Tue",
      },
    ],
  },
];

export const mockReplies: Record<string, string[]> = {
  th1: [
    "Perfect — locking it in. I'll tell the team. 🎯",
    "Copy that. Updating the launch doc now.",
  ],
  th2: [
    "Got it — I'll confirm on our side and circle back.",
    "Thanks Jon! That works for us.",
  ],
  th3: [
    "On it. Will have that sorted by EOD.",
    "Noted — adding it to Monday's prep.",
  ],
};
