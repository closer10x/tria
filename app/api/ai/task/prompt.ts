/**
 * The smart-task prompt and its output schema.
 *
 * Extracted from the route so anything exercising this path — the route, and
 * the self-test that runs it against a real message — shares one definition
 * rather than drifting copies.
 */

export const SMART_TASK_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description:
        "Imperative summary of what the recipient has to do, under 60 characters.",
    },
    note: {
      type: "string",
      description: "One short line of context. Empty string if none is needed.",
    },
    priority: { type: "string", enum: ["high", "medium", "low"] },
    due: {
      type: "string",
      description:
        "Deadline the sender asked for, as they phrased it (e.g. 'Friday EOD'). Empty string if none.",
    },
    checklist: {
      type: "array",
      description:
        "One item per distinct thing being requested. Split compound asks apart. 1-6 items.",
      items: {
        type: "object",
        properties: {
          label: {
            type: "string",
            description: "A single concrete action, imperative, under 80 characters.",
          },
        },
        required: ["label"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "note", "priority", "due", "checklist"],
  additionalProperties: false,
} as const;

export const SMART_TASK_SYSTEM =
  "You turn an email into a task for the person who received it. Read the whole message and list every distinct thing the sender is asking for as its own checklist item — a compound sentence asking for two things is two items. Ignore pleasantries and signatures. Use the recipient's perspective: the actions are things they must do.";

export type SmartTaskDraft = {
  title: string;
  note: string;
  priority: "high" | "medium" | "low";
  due: string;
  checklist: { label: string }[];
};
