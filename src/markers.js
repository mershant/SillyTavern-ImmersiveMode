// Colored and structural runs are carried through beat splitting as @@IM_OPEN_n@@ / @@IM_CLOSE_n@@
// markers and turned back into markup per beat.
// A colored run can span several beats. Each beat gets the runs still open at its start reopened,
// and closes whatever it leaves open, so every beat is balanced markup and keeps its color.
export function balanceMarkers(tokens) {
  const open = [];
  return tokens.map(token => {
    const prefix = open.map(id => `@@IM_OPEN_${id}@@`).join('');
    const re = /@@IM_(OPEN|CLOSE)_(\d+)@@/g;
    let m;
    while ((m = re.exec(token))) {
      if (m[1] === 'OPEN') open.push(m[2]);
      else { const at = open.lastIndexOf(m[2]); if (at !== -1) open.splice(at, 1); }
    }
    const suffix = [...open].reverse().map(id => `@@IM_CLOSE_${id}@@`).join('');
    return `${prefix}${token}${suffix}`;
  });
}
