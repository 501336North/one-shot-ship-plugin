/**
 * Test helper for release-channels.api.integration.test.sh (ship round 4, UR1'/UR8): parses a CLAUDE.md with
 * markdown-it (from the API checkout's node_modules, NODE_PATH) and prints one line per violation; exit 1 if any.
 *
 *   tsx md-check.ts <CLAUDE.md>
 *
 * The unverified team block (from the plugin's note line to its LAST closing line) must render as: the note (a
 * blockquote), ONE fenced code block with info string "text" whose content starts with the API's section heading,
 * and the closing line (a blockquote). Everything else must render exactly as it does with that block cut out: the
 * same headings, the same HTML blocks (the START/END markers), the same links, in the same order. So no team text
 * became a heading, a comment swallowing the END marker, a link definition, or anything outside the fence.
 */
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';

interface Token {
  type: string;
  tag: string;
  info: string;
  content: string;
  children: Token[] | null;
  attrGet(name: string): string | null;
}
interface MarkdownIt {
  parse(src: string, env: object): Token[];
}

const NOTE = '> Team/personal laws below are not covered by the signed prompt manifest (unverified).';
const CLOSE = '> End of unverified team/personal laws.';

const file = process.argv[2];
const requireApi = createRequire(path.join(process.env.API_REPO as string, 'package.json'));
const md = (requireApi('markdown-it') as (opts: object) => MarkdownIt)({ html: true });
const doc = fs.readFileSync(file, 'utf8');
const lines = doc.split('\n');
const start = lines.indexOf(NOTE);
const end = lines.lastIndexOf(CLOSE);
const problems: string[] = [];
if (start < 0 || end <= start) {
  console.log(`no unverified block (note at ${start}, closing line at ${end})`);
  process.exit(1);
}
const reference = [...lines.slice(0, start), ...lines.slice(end + 1)].join('\n');

// What the document's structure is, outside code blocks: headings, HTML blocks, link targets, in order.
const structure = (tokens: Token[]): string[] => {
  const out: string[] = [];
  tokens.forEach((t, i) => {
    if (t.type === 'heading_open') out.push(`${t.tag} ${tokens[i + 1].content}`);
    if (t.type === 'html_block') out.push(`html ${t.content.trim()}`);
    for (const c of t.children ?? []) {
      if (c.type === 'link_open') out.push(`link ${c.attrGet('href')}`);
      if (c.type === 'html_inline') out.push(`html-inline ${c.content}`);
    }
  });
  return out;
};

const tokens = md.parse(doc, {});
const got = structure(tokens);
const want = structure(md.parse(reference, {}));
if (JSON.stringify(got) !== JSON.stringify(want)) {
  problems.push(`structure outside the block differs:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
}

const fences = tokens.filter((t) => t.type === 'fence' || t.type === 'code_block');
const teamFences = fences.filter((t) => t.content.startsWith('## Custom Team Laws\n') || t.content.startsWith('## Custom Personal Laws\n'));
if (teamFences.length !== 1 || teamFences[0].type !== 'fence' || teamFences[0].info !== 'text') {
  problems.push(`expected one "text" fence holding the team section, got ${JSON.stringify(teamFences.map((t) => [t.type, t.info]))}`);
}
// The note, the fence and the closing line are consecutive blocks.
const fenceAt = tokens.indexOf(teamFences[0]);
const inlineText = (i: number) => (tokens[i] && tokens[i].type === 'inline' ? tokens[i].content : '');
if (fenceAt < 0 || tokens[fenceAt - 1]?.type !== 'blockquote_close' || inlineText(fenceAt - 3) !== NOTE.slice(2)) {
  problems.push('the note is not the blockquote right before the fence');
}
if (fenceAt < 0 || tokens[fenceAt + 1]?.type !== 'blockquote_open' || inlineText(fenceAt + 3) !== CLOSE.slice(2)) {
  problems.push('the closing line is not the blockquote right after the fence');
}

for (const p of problems) console.log(p);
process.exit(problems.length ? 1 : 0);
