const footerLinks = ["Platform", "Governance", "Developers", "Contact"];

export function Footer() {
  return (
    <footer className="border-t border-line py-10">
      <div className="section-shell flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div>
          <strong className="text-textPrimary">IntelliGuard</strong>
          <p className="mt-2 text-sm text-textSecondary">Governance wired into AI runtime.</p>
        </div>
        <div className="flex flex-wrap gap-5 text-sm text-textSecondary">
          {footerLinks.map((link) => (
            <a key={link} href={`#${link.toLowerCase()}`} className="transition hover:text-textPrimary">
              {link}
            </a>
          ))}
        </div>
        <p className="text-sm text-textSecondary">Copyright 2026 IntelliGuard. All rights reserved.</p>
      </div>
    </footer>
  );
}
