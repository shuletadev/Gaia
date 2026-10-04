// UserPromptSubmit hook: when a message is about the interface, remind Claude to load the design workflow and read
// the project's design notes first. Says nothing for other messages. Never blocks.
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let prompt = "";
  try {
    prompt = JSON.parse(raw).prompt ?? "";
  } catch {
    /* no payload: stay silent */
  }
  const ui = /\b(ui|ux|design|redesign|restyle|layout|screen|page|dashboard|component|button|modal|table|colou?rs?|fonts?|typograph\w*|spacing|theme|dark mode|light mode|responsive|mobile|phone|polish|look(s)? (better|generic|off)|landing|css|tailwind|animation)\b/i;
  if (!ui.test(prompt)) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext:
          "UI work detected. Before proposing or changing any interface: (1) invoke the design-workflow skill, (2) read design/DESIGN.md and design/references/, (3) tell the user which skills you loaded and which reference files you read. See CLAUDE.md > UI work.",
      },
    }),
  );
});
