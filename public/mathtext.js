// StudySync - turns LaTeX math in AI answers into plain readable text (runs in the browser,
// loaded before notebook.js). The notebook can't render LaTeX, so
//   $x = \frac{1}{2}at^2 + v_0 t + x_0$   →   x = ½at² + v₀t + x₀
// The AI is asked to write math this way already (ai.js); this catches what slips through,
// and also fixes chats saved before that.

(function () {
  const SUP = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", x: "ˣ", y: "ʸ", a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", k: "ᵏ", m: "ᵐ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", T: "ᵀ" };
  const SUB = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉", "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ" };
  const FRACTIONS = { "1/2": "½", "1/3": "⅓", "2/3": "⅔", "1/4": "¼", "3/4": "¾", "1/5": "⅕", "1/8": "⅛" };
  const SYMBOLS = {
    cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓", le: "≤", leq: "≤", ge: "≥", geq: "≥", neq: "≠", ne: "≠",
    approx: "≈", sim: "~", equiv: "≡", propto: "∝", infty: "∞", to: "→", rightarrow: "→", Rightarrow: "⇒",
    leftarrow: "←", leftrightarrow: "↔", degree: "°", circ: "°", partial: "∂", nabla: "∇", sum: "Σ", prod: "∏",
    int: "∫", in: "∈", cup: "∪", cap: "∩", subset: "⊂", forall: "∀", exists: "∃", angle: "∠", perp: "⊥",
    ldots: "…", cdots: "⋯", dots: "…", quad: " ", qquad: "  ",
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ",
    iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ",
    phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
    Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  };

  // The {…} group starting at s[i] (s[i] is "{"): returns [contents, index after "}"]
  function group(s, i) {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === "{") depth++;
      else if (s[j] === "}" && --depth === 0) return [s.slice(i + 1, j), j + 1];
    }
    return [s.slice(i + 1), s.length];
  }

  // One argument after a command or ^/_: a {group} or a single character
  function arg(s, i) {
    while (s[i] === " ") i++;
    if (s[i] === "{") return group(s, i);
    if (s[i] === "\\") {
      const m = s.slice(i).match(/^\\([A-Za-z]+)/);
      if (m) return [s.slice(i, i + m[0].length), i + m[0].length];
    }
    return [s[i] || "", i + 1];
  }

  const single = (t) => /^[\p{L}\p{N}\p{M}.]+$|^.$/u.test(t); // r², x₀, 12 need no brackets
  const GREEK = /^(alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Phi|Psi|Omega)$/;
  const wrap = (t) => (single(t) ? t : "(" + t + ")");
  function script(text, map, mark) {
    const chars = [...text];
    return chars.every((c) => map[c]) ? chars.map((c) => map[c]).join("") : mark + wrap(text);
  }

  // Convert the inside of one math segment
  function convert(s) {
    let out = "";
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === "\\") {
        const m = s.slice(i).match(/^\\([A-Za-z]+|.)/);
        const name = m ? m[1] : "";
        i += m ? m[0].length : 1;
        if (name === "frac" || name === "dfrac" || name === "tfrac") {
          const [a, next] = arg(s, i);
          const [b, end] = arg(s, next);
          i = end;
          const top = convert(a).trim(), bottom = convert(b).trim();
          out += FRACTIONS[top + "/" + bottom] || wrap(top) + "/" + wrap(bottom);
        } else if (name === "sqrt") {
          const [a, end] = arg(s, i);
          i = end;
          out += "√" + wrap(convert(a).trim());
        } else if (["text", "mathrm", "mathbf", "mathit", "operatorname", "textbf", "mathsf", "boldsymbol", "vec", "hat", "bar", "overline"].includes(name)) {
          const [a, end] = arg(s, i);
          i = end;
          out += convert(a) + (name === "vec" ? "⃗" : "");
        } else if (["left", "right", "big", "Big", "bigg", "Bigg", "displaystyle", "limits"].includes(name)) {
          // sizing only: drop it
        } else if (name === "," || name === ";" || name === ":" || name === " ") {
          out += " ";
        } else if (name === "{" || name === "}" || name === "%" || name === "$" || name === "_" || name === "#") {
          out += name;
        } else if (name === "\\") {
          out += " ";
        } else {
          out += SYMBOLS[name] !== undefined ? SYMBOLS[name] : name;
          if (GREEK.test(name) && s[i] === " " && /[A-Za-z]/.test(s[i + 1] || "")) i++; // "\Delta v" is Δv
        }
      } else if (c === "^" || c === "_") {
        const [a, end] = arg(s, i + 1);
        i = end;
        const text = convert(a);
        if (c === "^" && (text === "°" || text === "∘")) out += "°";
        else out += script(text, c === "^" ? SUP : SUB, c);
      } else if (c === "{" || c === "}") {
        i++;
      } else {
        out += c;
        i++;
      }
    }
    return out;
  }

  // Find math segments ($$…$$, $…$, \(…\), \[…\]) and convert them. A single $…$ only
  // counts as math when it hugs its contents ($x$, not "$5 and $10"), so prices stay.
  // Code (```blocks``` and `inline`) is left exactly as written.
  function mathToText(text) {
    if (typeof text !== "string" || !/[$\\]/.test(text)) return text;
    return text
      .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
      .map((part, i) => (i % 2 ? part : convertMath(part)))
      .join("");
  }

  function convertMath(text) {
    return text
      .replace(/\$\$([\s\S]+?)\$\$/g, (m, inner) => convert(inner).trim())
      .replace(/\\\[([\s\S]+?)\\\]/g, (m, inner) => convert(inner).trim())
      .replace(/\\\(([\s\S]+?)\\\)/g, (m, inner) => convert(inner).trim())
      .replace(/(^|[^\\\w$])\$(?=\S)([^$\n]*?\S)\$(?!\d)/g, (m, before, inner) => before + convert(inner));
  }

  if (typeof module !== "undefined") module.exports = { mathToText };
  else window.mathToText = mathToText;
})();
