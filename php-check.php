<?php
header('Content-Type: text/plain; charset=utf-8');
echo "php " . PHP_VERSION . "\n";
echo "mail " . (function_exists('mail') ? 'yes' : 'no') . "\n";
echo "sendmail_path " . ini_get('sendmail_path') . "\n";
