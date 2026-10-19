"""Envoie les e-mails de outbox/messages.json par le SMTP d'OVH, puis en range une copie
dans le dossier « Envoyés » de contact@maisyndic.lu (IMAP). N'affiche jamais le mot de passe."""
import imaplib, json, os, re, smtplib, ssl, sys, time
from email.message import EmailMessage
from email.utils import formatdate, make_msgid, formataddr

USER = "contact@maisyndic.lu"
PWD = os.environ.get("SMTP_PASSWORD", "")
if not PWD:
    sys.exit("Secret SMTP_PASSWORD absent.")
msgs = json.load(open("outbox/messages.json", encoding="utf-8"))
ctx = ssl.create_default_context()

def sent_folder(imap):
    typ, data = imap.list()
    names = []
    for raw in data or []:
        line = raw.decode(errors="replace")
        m = re.match(r'\((?P<f>[^)]*)\) "(?P<d>[^"]*)" (?P<n>.+)$', line)
        if not m:
            continue
        n = m.group("n").strip()
        names.append(n)
        if "\\Sent" in m.group("f"):
            return n
    for n in names:
        if re.search(r"sent|envoy", n, re.I):
            return n
    return None

failed = 0
for m in msgs:
    msg = EmailMessage()
    msg["From"] = formataddr(("mäisyndic", USER))
    msg["To"] = m["to"]
    if m.get("cc"):
        msg["Cc"] = m["cc"]
    msg["Reply-To"] = USER
    msg["Subject"] = m["subject"]
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain="maisyndic.lu")
    msg.set_content(m["body"])
    for f in m.get("attachments", []):
        with open(os.path.join("outbox", f), "rb") as fh:
            msg.add_attachment(fh.read(), maintype="application", subtype="pdf", filename=f)
    rcpts = [m["to"]] + ([m["cc"]] if m.get("cc") else [])
    try:
        with smtplib.SMTP_SSL("ssl0.ovh.net", 465, context=ctx, timeout=30) as s:
            s.login(USER, PWD)
            refused = s.send_message(msg, from_addr=USER, to_addrs=rcpts)
        print("ENVOYÉ :", m["to"], "|", m["subject"], "| refusés :", refused or "aucun")
    except Exception as e:
        failed += 1
        print("ÉCHEC :", m["to"], "|", type(e).__name__, str(e)[:120].replace(PWD, "***"))
        continue
    try:
        imap = imaplib.IMAP4_SSL("ssl0.ovh.net", 993, ssl_context=ctx)
        imap.login(USER, PWD)
        folder = sent_folder(imap)
        if folder:
            imap.append(folder, "\\Seen", imaplib.Time2Internaldate(time.time()), msg.as_bytes())
            print("  copie rangée dans :", folder)
        else:
            print("  dossier Envoyés introuvable : pas de copie")
        imap.logout()
    except Exception as e:
        print("  copie non rangée :", type(e).__name__)
sys.exit(1 if failed else 0)
