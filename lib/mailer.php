<?php
/**
 * mäisyndic — envoi des e-mails depuis contact@maisyndic.lu.
 * Utilisé par le formulaire de devis (contact.php) et par les statistiques
 * (lien de connexion au tableau de bord, rapport hebdomadaire).
 */

declare(strict_types=1);

if (!defined('TO_ADDRESS')) {
    define('TO_ADDRESS', 'contact@maisyndic.lu');
}
if (!defined('FROM_NAME')) {
    define('FROM_NAME', 'mäisyndic');
}
if (!isset($GLOBALS['via'])) {
    $GLOBALS['via'] = [];
}

function encode_header(string $s): string
{
    return mb_encode_mimeheader($s, 'UTF-8', 'B', "\r\n");
}

/**
 * Envoi par le serveur SMTP authentifié d'OVH (ssl0.ovh.net) quand le mot de passe
 * de la boîte est configuré (fichier ../data/smtp.php, écrit par la mise en ligne
 * à partir du secret GitHub SMTP_PASSWORD). Les e-mails sont alors signés DKIM
 * par OVH et passent les filtres anti-spam. Sinon, repli sur mail().
 */
function smtp_config(): ?array
{
    $file = dirname(__DIR__, 2) . '/data/smtp.php'; // lib/ -> www/ -> dossier du compte
    if (!is_file($file)) {
        return null;
    }
    $c = include $file;
    return (is_array($c) && !empty($c['pass'])) ? $c : null;
}

function smtp_send(array $c, string $to, string $data): bool
{
    $target = $c['target'] ?? 'ssl://ssl0.ovh.net:465';
    $fp = @stream_socket_client($target, $errno, $errstr, 15);
    if (!$fp) {
        $GLOBALS['smtp_err'] = 'connect:' . $errno;
        return false;
    }
    stream_set_timeout($fp, 15);
    $read = function () use ($fp): string {
        $out = '';
        while (($line = fgets($fp, 1024)) !== false) {
            $out .= $line;
            if (strlen($line) < 4 || $line[3] === ' ') {
                break;
            }
        }
        return $out;
    };
    // $step : libellé neutre enregistré en cas d'échec (jamais le contenu envoyé).
    $cmd = function (string $line, string $expect, string $step) use ($fp, $read): bool {
        fwrite($fp, $line . "\r\n");
        $resp = $read();
        if (strncmp($resp, $expect, strlen($expect)) !== 0) {
            $GLOBALS['smtp_err'] = $step . ':' . substr(trim($resp), 0, 3);
            return false;
        }
        return true;
    };
    $ok = strncmp($read(), '220', 3) === 0
        && $cmd('EHLO maisyndic.lu', '250', 'ehlo')
        && $cmd('AUTH LOGIN', '334', 'auth')
        && $cmd(base64_encode($c['user'] ?? TO_ADDRESS), '334', 'user')
        && $cmd(base64_encode($c['pass']), '235', 'pass')
        && $cmd('MAIL FROM:<' . TO_ADDRESS . '>', '250', 'from')
        && $cmd('RCPT TO:<' . $to . '>', '25', 'rcpt')
        && $cmd('DATA', '354', 'data');
    if ($ok) {
        $body = preg_replace('/^\./m', '..', str_replace(["\r\n", "\r", "\n"], ["\n", "\n", "\r\n"], $data));
        $ok = $cmd($body . "\r\n.", '250', 'body');
    }
    @fwrite($fp, "QUIT\r\n");
    fclose($fp);
    return $ok;
}


/**
 * $attachments : liste de ['name' => 'fichier.pdf', 'data' => contenu binaire].
 */
function send_mail(string $to, string $subject, string $body, string $replyTo, array $attachments = []): bool
{
    $headers = [
        'Date: ' . date('r'),
        'Message-ID: <' . bin2hex(random_bytes(12)) . '@maisyndic.lu>',
        'From: ' . encode_header(FROM_NAME) . ' <' . TO_ADDRESS . '>',
        'Reply-To: ' . $replyTo,
        'MIME-Version: 1.0',
    ];
    if ($attachments) {
        $b = 'ms-' . bin2hex(random_bytes(10));
        $headers[] = 'Content-Type: multipart/mixed; boundary="' . $b . '"';
        $mime = "This is a multi-part message in MIME format.\r\n\r\n--{$b}\r\n"
            . "Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n" . $body . "\r\n";
        foreach ($attachments as $a) {
            $fname = preg_replace('/[^A-Za-z0-9._-]/', '-', $a['name']);
            $mime .= "--{$b}\r\nContent-Type: application/pdf; name=\"{$fname}\"\r\n"
                . "Content-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"{$fname}\"\r\n\r\n"
                . chunk_split(base64_encode($a['data']), 76, "\r\n");
        }
        $body = $mime . "--{$b}--\r\n";
    } else {
        $headers[] = 'Content-Type: text/plain; charset=UTF-8';
        $headers[] = 'Content-Transfer-Encoding: 8bit';
    }
    $c = smtp_config();
    if ($c !== null) {
        $data = 'To: ' . $to . "\r\n" . 'Subject: ' . encode_header($subject) . "\r\n" . implode("\r\n", $headers) . "\r\n\r\n" . $body;
        if (smtp_send($c, $to, $data)) {
            $GLOBALS['via'][] = 'smtp';
            return true;
        }
        $GLOBALS['via'][] = 'smtp-failed(' . ($GLOBALS['smtp_err'] ?? '?') . ')';
    }
    $GLOBALS['via'][] = 'mail';
    return mail($to, encode_header($subject), $body, implode("\r\n", $headers), '-f' . TO_ADDRESS);
}
