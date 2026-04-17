async function run() {
  try {
    const res = await fetch('http://localhost:3000/api/assets/video/search?q=AI');
    const json = await res.json();
    console.log("Found", json.length, "items.");
    const hydrated = json.filter(v => v.score !== undefined && v.score !== 0);
    console.log("Hydrated:", hydrated.length, hydrated.slice(0, 2));
  } catch(e) {
    console.error("Local server unavilable or error:", e.message);
  }
}
run();
