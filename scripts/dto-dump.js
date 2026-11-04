// Dumps compact DTO schema summaries from the OpenAPI document for frontend typing.
const s = require('/tmp/openapi.json');
const lines = [];
const typeOf = (p) => {
  if (!p) return '?';
  if (p.type) {
    let t = p.type;
    if (t === 'array') t += '<' + typeOf(p.items) + '>';
    if (p.enum) t += '(' + p.enum.join('|') + ')';
    if (p.format) t += ':' + p.format;
    return t;
  }
  if (p.$ref) return p.$ref.split('/').pop();
  if (p.oneOf) return p.oneOf.map(typeOf).join('|');
  if (p.anyOf) return p.anyOf.map(typeOf).join('|');
  return 'obj';
};
for (const [name, sch] of Object.entries(s.components.schemas)) {
  const req = sch.required ?? [];
  const props = Object.entries(sch.properties ?? {})
    .map(([k, v]) => `${k}${req.includes(k) ? '*' : ''}:${typeOf(v)}`)
    .join(', ');
  lines.push(`### ${name}${props ? ' => ' + props : ' (no props)'}`);
}
for (const [p, m] of Object.entries(s.paths)) {
  for (const [method, op] of Object.entries(m)) {
    if (!['post', 'patch', 'put'].includes(method)) continue;
    const body = op.requestBody?.content?.['application/json']?.schema;
    if (!body) continue;
    const ref = body.$ref ? body.$ref.split('/').pop() : JSON.stringify(body).slice(0, 120);
    lines.push(`${method.toUpperCase()} ${p}  body=${ref}`);
  }
}
require('fs').writeFileSync('/tmp/dto-summary.txt', lines.join('\n'));
console.log('written', lines.length, 'lines');
