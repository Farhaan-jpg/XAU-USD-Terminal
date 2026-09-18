/* Global outbound request gate: caps concurrent upstream fetches so bursts
   (e.g. browser boot firing quotes+bias+news+calendar at once) never
   trigger Yahoo / RSS / Socrata rate limits. */

const MAX_CONCURRENT = 3;
const SPACING_MS = 150;

let active = 0;
const waiters = [];

function pump() {
  if (!waiters.length || active >= MAX_CONCURRENT) return;
  const resolve = waiters.shift();
  active++;
  resolve();
}

export async function gate(task) {
  await new Promise((resolve) => {
    waiters.push(resolve);
    pump();
  });
  try {
    await new Promise((r) => setTimeout(r, SPACING_MS));
    return await task();
  } finally {
    active--;
    pump();
  }
}