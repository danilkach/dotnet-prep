'use strict';

// A small highlighter for the two languages the sections use, so the app needs no library and stays offline.
// Anything that looks like neither — an ASCII diagram, a command line — is left as it is.
(function () {
  const CS_KEYWORDS = new Set(('abstract as async await base bool break byte case catch char checked class const continue ' +
    'decimal default delegate do double else enum event explicit extern false field finally fixed float for foreach goto if ' +
    'implicit in init int interface internal is lock long nameof namespace new null object operator out override params ' +
    'partial private protected public readonly record ref required return sbyte scoped sealed short sizeof stackalloc static ' +
    'string struct switch this throw true try typeof uint ulong unchecked unmanaged unsafe ushort using var virtual void ' +
    'volatile when where while with yield get set value global extension notnull dynamic managed file').split(' '));
  const SQL_KEYWORDS = new Set(('select from where and or not in is null as join left right full inner outer cross on group by ' +
    'order having limit offset insert into values update set delete create table index unique primary key foreign ' +
    'references alter add drop column constraint check default begin commit rollback transaction isolation level read ' +
    'committed repeatable serializable for share skip locked nowait with recursive union all distinct case when then else ' +
    'end exists between like ilike returning conflict do nothing explain analyze buffers vacuum over partition rows range ' +
    'window asc desc nulls first last using merge matched include concurrently if lateral filter grant to revoke policy ' +
    'enable row level security function returns language trigger sequence view materialized cascade only top go exec ' +
    'declare output nolock clustered nonclustered fetch next only').split(' '));

  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const span = (cls, text) => `<span class="hl-${cls}">${esc(text)}</span>`;

  function detect(code) {
    if (/^\s*(SELECT|WITH|INSERT|UPDATE|DELETE|CREATE|ALTER|EXPLAIN|BEGIN|SET|DROP|VACUUM|ANALYZE|MERGE|DECLARE|GRANT)\b/m.test(code) &&
        !/\b(public|private|var|await|class|using)\b/.test(code))
      return 'sql';
    if (/[;{}]\s*$/m.test(code) || /\b(var|public|class|async|await|using|return|new)\b/.test(code)) return 'cs';
    return null;
  }

  const CS_TOKENS = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(\$?@?"(?:[^"\\\n]|\\.|"")*"|'(?:[^'\\\n]|\\.)')|(\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[fFdDmMuUlL]*\b|\b0x[\da-fA-F_]+\b)|(\[[A-Z]\w*(?:\([^\]\n]*\))?\])|([A-Za-z_]\w*)/g;
  const SQL_TOKENS = /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)/g;

  function highlight(code, lang) {
    const tokens = lang === 'sql' ? SQL_TOKENS : CS_TOKENS;
    let out = '', last = 0, m;
    tokens.lastIndex = 0;
    while ((m = tokens.exec(code))) {
      out += esc(code.slice(last, m.index));
      last = tokens.lastIndex;
      const [text, comment, str, num, fourth, fifth] = m;
      if (comment) out += span('comment', text);
      else if (str) out += span('string', text);
      else if (num) out += span('number', text);
      else if (lang === 'sql') {
        out += SQL_KEYWORDS.has(text.toLowerCase()) ? span('keyword', text) : esc(text);
      } else if (fourth) out += span('attr', text);
      else if (CS_KEYWORDS.has(fifth)) out += span('keyword', text);
      else if (/^[A-Z]/.test(fifth)) out += span('type', text);
      else out += esc(text);
    }
    return out + esc(code.slice(last));
  }

  window.highlightCode = function (root) {
    root.querySelectorAll('pre code').forEach(el => {
      if (el.dataset.hl) return;
      const code = el.textContent;
      const lang = detect(code);
      el.dataset.hl = lang || 'plain';
      if (lang) el.innerHTML = highlight(code, lang);
    });
  };
})();
