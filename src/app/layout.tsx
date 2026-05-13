import type { ReactNode } from "react";
import type { Metadata } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Shopify Product Manager",
  description: "Shopify product and variant management dashboard"
};

// Bitdefender's TrafficLight extension injects `bis_skin_checked` attributes on
// every <div> after the server HTML is parsed but before React hydrates. That
// causes hydration warnings on dozens of nested elements, which
// suppressHydrationWarning can't fix (it only applies one level deep). This
// strips the attribute before React hydrates and keeps stripping as the
// extension reinjects.
const STRIP_EXTENSION_ATTRS = `
(function(){
  var BAD = ['bis_skin_checked','bis_register'];
  function clean(node){
    if (!node || node.nodeType !== 1) return;
    for (var i = 0; i < BAD.length; i++) if (node.hasAttribute && node.hasAttribute(BAD[i])) node.removeAttribute(BAD[i]);
    if (node.attributes) {
      for (var j = node.attributes.length - 1; j >= 0; j--) {
        var n = node.attributes[j].name;
        if (n.indexOf('__processed_') === 0) node.removeAttribute(n);
      }
    }
  }
  function walk(root){
    if (!root) return;
    clean(root);
    if (root.querySelectorAll) {
      var els = root.querySelectorAll('*');
      for (var i = 0; i < els.length; i++) clean(els[i]);
    }
  }
  walk(document.documentElement);
  var mo = new MutationObserver(function(muts){
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === 'attributes') clean(m.target);
      if (m.addedNodes) for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: BAD });
})();
`;

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: STRIP_EXTENSION_ATTRS }} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
