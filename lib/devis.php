<?php
/**
 * Copie d'une demande de devis à l'application de gestion (app.maisyndic.lu), pour son suivi par l'équipe et les deux
 * rappels au demandeur (7 et 30 jours après la demande). Requête signée : HMAC-SHA256 de « horodatage.corps » avec le
 * jeton partagé (fichier ../data/devis.php, écrit par la mise en ligne à partir du secret GitHub DEVIS_JETON, même valeur
 * que PROD_DEVIS_JETON dans le dépôt de l'application). Sans ce fichier, rien n'est fait.
 * Ne bloque jamais le formulaire : 5 secondes au plus ; un échec est seulement noté, sans le contenu de la demande.
 */
function forward_quote_request(array $data): void
{
    $file = dirname(__DIR__, 2) . '/data/devis.php'; // lib/ -> www/ -> dossier du compte
    $c = is_file($file) ? include $file : null;
    if (!is_array($c) || empty($c['jeton']) || empty($c['url'])) {
        return;
    }
    $body = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($body === false) {
        return;
    }
    $ts = (string) time();
    $headers = [
        'Content-Type: application/json',
        'X-Maisyndic-Horodatage: ' . $ts,
        'X-Maisyndic-Signature: ' . hash_hmac('sha256', $ts . '.' . $body, (string) $c['jeton']),
    ];
    $status = 0;
    try {
        if (function_exists('curl_init')) {
            $ch = curl_init((string) $c['url']);
            curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_HTTPHEADER => $headers,
                CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5, CURLOPT_CONNECTTIMEOUT => 3]);
            curl_exec($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
        } else {
            $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => $body,
                'timeout' => 5, 'ignore_errors' => true]]);
            @file_get_contents((string) $c['url'], false, $ctx);
            if (isset($http_response_header[0]) && preg_match('#\s(\d{3})\s#', $http_response_header[0], $m)) {
                $status = (int) $m[1];
            }
        }
    } catch (Throwable $e) {
        $status = 0;
    }
    if ($status !== 201) {
        error_log('maisyndic devis: transmission a l\'application refusee ou impossible (code ' . $status . ')');
    }
}
