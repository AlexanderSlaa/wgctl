import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const CTRL_C = String.fromCharCode(3);
const BACKSPACE_DEL = String.fromCharCode(127);
const BACKSPACE_BS = "\b";

export async function askText(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/**
 * Masked password input via raw-mode keypress handling — readline/promises
 * has no built-in support for this. Standard no-dependency pattern: switch
 * stdin to raw mode, echo "*" per visible character, handle backspace and
 * Ctrl-C, resolve on Enter, always restore the terminal mode afterwards.
 */
export async function askPassword(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    stdout.write(question);
    let password = "";
    const wasRaw = stdin.isRaw;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode?.(wasRaw ?? false);
      stdin.pause();
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(password);
          return;
        }
        if (char === CTRL_C) {
          cleanup();
          reject(new Error("Aborted"));
          return;
        }
        if (char === BACKSPACE_DEL || char === BACKSPACE_BS) {
          if (password.length > 0) {
            password = password.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        password += char;
        stdout.write("*");
      }
    };

    stdin.on("data", onData);
  });
}

/** Numbered single-choice prompt. Returns the selected item's index (0-based). */
export async function askChoice(question: string, options: string[]): Promise<number> {
  stdout.write(question + "\n");
  options.forEach((opt, i) => stdout.write(`  ${i + 1}) ${opt}\n`));
  while (true) {
    const answer = await askText("Enter a number: ");
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) {
      return n - 1;
    }
    stdout.write(`Please enter a number between 1 and ${options.length}.\n`);
  }
}

/** Numbered multi-choice prompt. Accepts comma-separated numbers or "all". Returns selected indices (0-based). */
export async function askMultiChoice(question: string, options: string[]): Promise<number[]> {
  stdout.write(question + "\n");
  options.forEach((opt, i) => stdout.write(`  ${i + 1}) ${opt}\n`));
  while (true) {
    const answer = await askText('Enter numbers (comma-separated) or "all": ');
    if (answer.trim().toLowerCase() === "all") {
      return options.map((_, i) => i);
    }
    const parts = answer
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const indices = parts.map((p) => Number(p) - 1);
    if (indices.length > 0 && indices.every((i) => Number.isInteger(i) && i >= 0 && i < options.length)) {
      return indices;
    }
    stdout.write(`Please enter valid numbers between 1 and ${options.length}, comma-separated.\n`);
  }
}
