import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Helper: Normalize text (leetspeak removal)
function normalizeFilterToken(value: string): string {
  const map: Record<string, string> = {
    "$": "s", "5": "s", "€": "e", "3": "e", "@": "a", "4": "a",
    "0": "o", "1": "i", "!": "i", "|": "i", "+": "t", "7": "t",
    "8": "b", "9": "g", "2": "z"
  };
  return value.toLowerCase()
    .split("").map(c => map[c] || c).join("")
    .replace(/[^a-z]/g, "")
    .replace(/(.)\1{2,}/g, "$1$1");
}

// Helper: Damerau-Levenshtein Distance
function getDamerauLevenshteinDistance(a: string, b: string): number {
  const source = normalizeFilterToken(a);
  const target = normalizeFilterToken(b);
  const m = source.length;
  const n = target.length;
  if (!m) return n;
  if (!n) return m;

  const matrix = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) matrix[i][0] = i;
  for (let j = 0; j <= n; j++) matrix[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = source[i - 1] === target[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && source[i - 1] === target[j - 2] && source[i - 2] === target[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost);
      }
    }
  }
  return matrix[m][n];
}

function tokenMatchesFilteredWord(token: string, filteredWord: string): boolean {
  const normToken = normalizeFilterToken(token);
  const normWord = normalizeFilterToken(filteredWord);
  if (!normToken || !normWord) return false;
  if (normToken === normWord) return true;
  if (normWord.length < 5) return false;
  
  const lenDelta = Math.abs(normToken.length - normWord.length);
  if (lenDelta > 1) return false;

  const skeleton = (s: string) => s.replace(/[aeiou]/g, "");
  if (skeleton(normToken) === skeleton(normWord) && lenDelta <= 1) return true;

  const distance = getDamerauLevenshteinDistance(normToken, normWord);
  const maxDist = normWord.length >= 8 ? 2 : 1;
  return distance <= maxDist;
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const { text, serverId } = await req.json();
  if (!text || !serverId) return new Response("Missing data", { status: 400 });

  // 1. Fetch active filters from DB
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const { data: filters, error } = await fetch(`${supabaseUrl}/rest/v1/server_word_filters`, {
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json"
    },
    params: { server_id: `eq.${serverId}`, is_active: `eq.true` }
  }).then(r => r.json());

  if (error || !filters || filters.length === 0) {
    return new Response(JSON.stringify({ text }), { status: 200 });
  }

  const filterWords = filters.map((f: any) => f.word.toLowerCase());

  // 2. Perform Censorship
  const regex = /[A-Za-z0-9@$!+|€._-]+/g;
  const result = text.replace(regex, (token) => {
    const isMatch = filterWords.some(word => tokenMatchesFilteredWord(token, word));
    return isMatch ? "*".repeat(token.length) : token;
  });

  return new Response(JSON.stringify({ text: result }), { status: 200 });
});