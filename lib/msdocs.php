<?php
/**
 * mäisyndic — devis et contrats en PDF (bibliothèque FPDF, polices standard).
 *
 * ms_quote_pdf()    : le devis, dans la langue du demandeur.
 * ms_contract_pdf() : le contrat (français), pré-rempli ou contrat type.
 * Les textes viennent de quote-data.json, généré par le site (quote_pdf.py).
 */

declare(strict_types=1);

require_once __DIR__ . '/fpdf.php';

/** UTF-8 -> Windows-1252 (jeu de caractères des polices standard du PDF). */
function ms_t(string $s): string
{
    $s = str_replace(["\u{202F}", "\u{2009}", "\u{2011}", "\u{2212}"], ["\u{00A0}", ' ', '-', '-'], $s);
    return mb_convert_encoding($s, 'Windows-1252', 'UTF-8');
}

class MsPdf extends FPDF
{
    public array $brand = [11, 95, 165];
    public array $ink = [24, 33, 45];
    public array $muted = [96, 108, 122];
    public string $footerLine = '';
    public string $pageLabel = '{n} / {t}';
    public string $logo = '';
    public string $runningTitle = '';

    public function __construct()
    {
        parent::__construct('P', 'mm', 'A4');
        $this->SetMargins(18, 18, 18);
        $this->SetAutoPageBreak(true, 22);
        $this->AliasNbPages('{nb}');
        $this->SetCreator('maisyndic.lu', true);
        $this->SetAuthor('BUSINESS EVOLUTION SARL - mäisyndic', true);
    }

    public function Header(): void
    {
        if ($this->PageNo() === 1) {
            return;
        }
        $this->SetFont('Helvetica', 'B', 9);
        $this->SetTextColor(...$this->brand);
        $this->Cell(60, 5, ms_t('mäisyndic'), 0, 0, 'L');
        $this->SetFont('Helvetica', '', 8);
        $this->SetTextColor(...$this->muted);
        $this->Cell(0, 5, ms_t($this->runningTitle), 0, 1, 'R');
        $this->SetDrawColor(220, 226, 233);
        $this->Line(18, $this->GetY() + 1, 192, $this->GetY() + 1);
        $this->Ln(6);
    }

    public function Footer(): void
    {
        $this->SetY(-16);
        $this->SetDrawColor(220, 226, 233);
        $this->Line(18, $this->GetY(), 192, $this->GetY());
        $this->Ln(1.5);
        $this->SetFont('Helvetica', '', 7);
        $this->SetTextColor(...$this->muted);
        $this->MultiCell(150, 3.4, ms_t($this->footerLine), 0, 'L');
        $this->SetXY(168, -14.5);
        $label = str_replace(['{n}', '{t}'], [(string) $this->PageNo(), '{nb}'], $this->pageLabel);
        $this->Cell(24, 4, ms_t($label), 0, 0, 'R');
    }

    public function ensureSpace(float $h): void
    {
        if ($this->GetY() + $h > $this->PageBreakTrigger) {
            $this->AddPage();
        }
    }

    public function h1(string $txt): void
    {
        $this->SetFont('Helvetica', 'B', 16);
        $this->SetTextColor(...$this->ink);
        $this->MultiCell(0, 7.5, ms_t($txt), 0, 'L');
        $this->Ln(1);
    }

    public function h2(string $txt, float $before = 5): void
    {
        $this->ensureSpace(22);
        $this->Ln($before);
        $this->SetFont('Helvetica', 'B', 11.5);
        $this->SetTextColor(...$this->brand);
        $this->MultiCell(0, 6, ms_t($txt), 0, 'L');
        $this->Ln(1);
    }

    public function meta(string $txt): void
    {
        $this->SetFont('Helvetica', '', 8.5);
        $this->SetTextColor(...$this->muted);
        $this->MultiCell(0, 4.2, ms_t($txt), 0, 'L');
        $this->Ln(2);
    }

    /** Paragraphe avec **gras** ; retour à la ligne automatique. */
    public function rich(string $txt, float $size = 9.5, float $lh = 4.9, float $after = 2.2): void
    {
        $this->SetTextColor(...$this->ink);
        $parts = preg_split('/(\*\*.+?\*\*)/u', $txt, -1, PREG_SPLIT_DELIM_CAPTURE | PREG_SPLIT_NO_EMPTY) ?: [];
        foreach ($parts as $p) {
            $bold = str_starts_with($p, '**') && str_ends_with($p, '**');
            $this->SetFont('Helvetica', $bold ? 'B' : '', $size);
            $this->Write($lh, ms_t($bold ? substr($p, 2, -2) : $p));
        }
        $this->Ln($lh + $after);
    }

    public function bullet(string $txt, string $mark = "\u{2022}", float $size = 9.5): void
    {
        $this->ensureSpace(8);
        $x0 = $this->lMargin;
        $this->SetFont('Helvetica', 'B', $size);
        $this->SetTextColor(...$this->brand);
        $this->SetX($x0 + 1);
        $this->Cell(5, 4.9, ms_t($mark), 0, 0, 'L');
        $this->SetLeftMargin($x0 + 6);
        $this->SetX($x0 + 6);
        $this->rich($txt, $size, 4.9, 1.2);
        $this->SetLeftMargin($x0);
        $this->SetX($x0);
    }

    /** Nombre de lignes d'un texte dans une colonne de largeur $w. */
    public function nbLines(float $w, string $txt): int
    {
        $cw = $this->CurrentFont['cw'];
        $wmax = ($w - 2 * $this->cMargin) * 1000 / $this->FontSize;
        $s = str_replace("\r", '', $txt);
        $nb = strlen($s);
        if ($nb > 0 && $s[$nb - 1] === "\n") {
            $nb--;
        }
        $sep = -1;
        $i = 0;
        $j = 0;
        $l = 0;
        $nl = 1;
        while ($i < $nb) {
            $c = $s[$i];
            if ($c === "\n") {
                $i++;
                $sep = -1;
                $j = $i;
                $l = 0;
                $nl++;
                continue;
            }
            if ($c === ' ') {
                $sep = $i;
            }
            $l += $cw[$c] ?? 500;
            if ($l > $wmax) {
                if ($sep === -1) {
                    if ($i === $j) {
                        $i++;
                    }
                } else {
                    $i = $sep + 1;
                }
                $sep = -1;
                $j = $i;
                $l = 0;
                $nl++;
            } else {
                $i++;
            }
        }
        return $nl;
    }

    /**
     * Tableau à hauteur de ligne variable.
     * $opt : align (par colonne), size, bold_first (1re colonne en gras), total_rows (indices en gras).
     */
    public function table(array $w, array $head, array $rows, array $opt = []): void
    {
        $size = $opt['size'] ?? 8.8;
        $lh = $size * 0.47;
        $align = $opt['align'] ?? [];
        $boldRows = $opt['bold_rows'] ?? [];
        $this->SetDrawColor(214, 221, 229);
        $this->SetLineWidth(0.2);
        $drawRow = function (array $cells, bool $isHead, bool $bold) use ($w, $size, $lh, $align): void {
            $this->SetFont('Helvetica', ($isHead || $bold) ? 'B' : '', $isHead ? $size - 0.4 : $size);
            $n = 1;
            foreach ($cells as $i => $c) {
                $n = max($n, $this->nbLines($w[$i], ms_t((string) $c)));
            }
            $h = $n * $lh + 3;
            if ($this->GetY() + $h > $this->PageBreakTrigger) {
                $this->AddPage();
            }
            $x = $this->lMargin;
            $y = $this->GetY();
            foreach ($cells as $i => $c) {
                if ($isHead) {
                    $this->SetFillColor(...$this->brand);
                    $this->SetTextColor(255, 255, 255);
                    $this->Rect($x, $y, $w[$i], $h, 'DF');
                } else {
                    $this->SetTextColor(...$this->ink);
                    if ($bold) {
                        $this->SetFillColor(238, 244, 251);
                        $this->Rect($x, $y, $w[$i], $h, 'DF');
                    } else {
                        $this->Rect($x, $y, $w[$i], $h);
                    }
                }
                $this->SetXY($x, $y + 1.5);
                $this->MultiCell($w[$i], $lh, ms_t((string) $c), 0, $align[$i] ?? 'L');
                $x += $w[$i];
            }
            $this->SetXY($this->lMargin, $y + $h);
        };
        if ($head) {
            $drawRow($head, true, false);
        }
        foreach ($rows as $k => $r) {
            $drawRow($r, false, in_array($k, $boldRows, true));
        }
        $this->Ln(3);
    }

    /** Bloc de signatures sur deux colonnes. */
    public function signatures(array $titles, array $names, array $mentions): void
    {
        $this->ensureSpace(48);
        $this->Ln(4);
        $y = $this->GetY();
        foreach ([0, 1] as $i) {
            $x = 18 + $i * 90;
            $this->SetDrawColor(214, 221, 229);
            $this->Rect($x, $y, 84, 42);
            $this->SetXY($x + 3, $y + 3);
            $this->SetFont('Helvetica', 'B', 9);
            $this->SetTextColor(...$this->ink);
            $this->MultiCell(78, 4.5, ms_t($titles[$i]), 0, 'L');
            $this->SetX($x + 3);
            $this->SetFont('Helvetica', '', 8.5);
            $this->MultiCell(78, 4.3, ms_t($names[$i]), 0, 'L');
            $this->SetX($x + 3);
            $this->SetFont('Helvetica', 'I', 8);
            $this->SetTextColor(...$this->muted);
            $this->MultiCell(78, 4.3, ms_t($mentions[$i]), 0, 'L');
            $this->SetXY($x + 3, $y + 34);
            $this->SetFont('Helvetica', '', 8);
            $this->Cell(78, 4, ms_t('Signature :'), 0, 0, 'L');
        }
        $this->SetXY(18, $y + 46);
    }

    /** En-tête de première page : logo, nom, et un bloc à droite. */
    public function brandHeader(array $rightLines, string $bigTitle = '', string $tagline = 'Syndic de copropriété · Luxembourg'): void
    {
        $top = 16;
        if ($this->logo !== '' && is_file($this->logo)) {
            $this->Image($this->logo, 18, $top, 12.5);
        }
        $this->SetXY(33, $top + 1.5);
        $this->SetFont('Helvetica', 'B', 17);
        $this->SetTextColor(...$this->brand);
        $this->Cell(60, 7, ms_t('mäisyndic'), 0, 2, 'L');
        $this->SetFont('Helvetica', '', 8);
        $this->SetTextColor(...$this->muted);
        $this->Cell(60, 4, ms_t($tagline), 0, 2, 'L');
        $this->SetXY(110, $top);
        if ($bigTitle !== '') {
            $this->SetFont('Helvetica', 'B', 18);
            $this->SetTextColor(...$this->ink);
            $this->Cell(82, 8, ms_t($bigTitle), 0, 2, 'R');
        }
        foreach ($rightLines as $line) {
            $this->SetFont('Helvetica', '', 8.5);
            $this->SetTextColor(...$this->muted);
            $this->Cell(82, 4.4, ms_t($line), 0, 2, 'R');
        }
        $this->SetY(max($this->GetY(), $top + 16) + 5);
        $this->SetDrawColor(...$this->brand);
        $this->SetLineWidth(0.6);
        $this->Line(18, $this->GetY(), 192, $this->GetY());
        $this->SetLineWidth(0.2);
        $this->Ln(6);
    }

    /** Deux encadrés côte à côte (émetteur / destinataire). */
    public function twoBoxes(string $t1, array $l1, string $t2, array $l2): void
    {
        $y = $this->GetY();
        $hMax = 0;
        foreach ([[$t1, $l1, 18], [$t2, $l2, 107]] as [$t, $lines, $x]) {
            $this->SetXY($x + 4, $y + 3);
            $this->SetFont('Helvetica', 'B', 8);
            $this->SetTextColor(...$this->brand);
            $this->Cell(77, 4.5, ms_t(mb_strtoupper($t)), 0, 2, 'L');
            foreach ($lines as $i => $line) {
                $this->SetFont('Helvetica', $i === 0 ? 'B' : '', $i === 0 ? 9.5 : 8.6);
                $this->SetTextColor(...$this->ink);
                $this->SetX($x + 4);
                $this->MultiCell(77, 4.4, ms_t($line), 0, 'L');
            }
            $hMax = max($hMax, $this->GetY() - $y + 3);
        }
        $this->SetDrawColor(214, 221, 229);
        $this->Rect(18, $y, 85, $hMax);
        $this->Rect(107, $y, 85, $hMax);
        $this->SetXY(18, $y + $hMax + 6);
    }
}

/* ------------------------------------------------------------------ */

function ms_rate(array $grid, int $lots): array
{
    $prev = 1;
    foreach ($grid['tiers'] as $i => $tier) {
        if ($tier[0] === null || $lots <= $tier[0]) {
            return [(float) $tier[1], $i, $prev + 1, $tier[0]];
        }
        $prev = $tier[0];
    }
    return [0.0, 0, 2, null];
}

/**
 * Le devis.
 * $c : lang, ref, date, valid, name, email, phone, role, commune, residence, lots, plan ('' si non choisi),
 *      contract ('filled'|'model'), money (callable(float, int): string)
 */
function ms_quote_pdf(array $D, array $c): string
{
    $T = $D['i18n'][$c['lang']] ?? $D['i18n']['fr'];
    $money = $c['money'];
    $lots = (int) $c['lots'];
    $pdf = new MsPdf();
    $pdf->logo = __DIR__ . '/logo.jpg';
    $pdf->footerLine = $D['meta']['company_line'] . ' · ' . $D['contact']['email'] . ' · ' . $D['contact']['phone'];
    $pdf->pageLabel = $T['page'];
    $pdf->runningTitle = $T['ref'] . ' ' . $c['ref'];
    $pdf->SetTitle($T['title'] . ' ' . $c['ref'], true);
    $pdf->AddPage();
    $pdf->brandHeader([
        $T['ref'] . ' ' . $c['ref'],
        $T['date'] . ' : ' . $c['date'],
        $T['valid'] . ' : ' . $c['valid'],
    ], $T['title'], $T['tagline']);

    $client = [$c['name']];
    if ($c['role'] !== '') {
        $client[] = $c['role'];
    }
    $client[] = $c['email'];
    if ($c['phone'] !== '') {
        $client[] = $c['phone'];
    }
    $client[] = $T['building'] . ' : ' . ($c['residence'] !== '' ? $c['residence'] . ', ' : '') . $c['commune'];
    $client[] = str_replace('{n}', (string) $lots, $T['homes']);
    $pdf->twoBoxes($T['issuer'], [
        'BUSINESS EVOLUTION SARL – mäisyndic',
        $D['contact']['address'],
        'RCS B251188 · TVA LU32737432',
        $D['contact']['email'] . ' · ' . $D['contact']['phone'],
    ], $T['client'], $client);

    $plan = $c['plan'];
    $isSyndic = $plan !== 'benevole';
    if ($plan !== '') {
        $grid = $D['prices'][$plan];
        $pname = $T['plans'][$plan]['name'];
        [$rate, $ti, $from, $to] = ms_rate($grid, $lots);
        $tierTxt = '';
        if (count($grid['tiers']) > 1) {
            $label = $ti === 0 ? str_replace('{b}', (string) $to, $T['tier_first'])
                : ($to === null ? str_replace('{a}', (string) $from, $T['tier_last'])
                    : str_replace(['{a}', '{b}'], [(string) $from, (string) $to], $T['tier_mid']));
            $tierTxt = str_replace('{t}', $label, $T['tier']);
        }
        $base = $rate * $lots;
        $monthly = max($base, (float) $grid['min']);
        $pdf->h2(str_replace('{plan}', $pname, $T['intro_plan']), 0);
        $rows = [[str_replace(['{plan}', '{tier}'], [$pname, $tierTxt], $T['fee_line']),
            str_replace('{n}', (string) $lots, $T['homes']),
            $money($rate, 2) . "\n" . $T['unit_home'], $money($base, 2)]];
        if ($base < $monthly) {
            $rows[] = [str_replace('{min}', $money((float) $grid['min'], 0), $T['min_line']), '', '', $money($monthly - $base, 2)];
        }
        $pdf->table([88, 26, 32, 28], [$T['col_desc'], $T['col_qty'], $T['col_unit'], $T['col_total']], $rows,
            ['align' => ['L', 'C', 'R', 'R']]);
        // Récapitulatif mensuel et annuel.
        $vat = 0.17;
        $pdf->table([88, 43, 43], ['', $T['month'], $T['year']], [
            [$T['ht'], $money($monthly, 2), $money($monthly * 12, 2)],
            [$T['vat'], $money($monthly * $vat, 2), $money($monthly * 12 * $vat, 2)],
            [$T['ttc'], $money($monthly * (1 + $vat), 2), $money($monthly * 12 * (1 + $vat), 2)],
        ], ['align' => ['L', 'R', 'R'], 'bold_rows' => [2]]);
        $pdf->rich($T['no_setup'], 9);
        $pdf->h2(str_replace('{plan}', $pname, $T['included']));
        foreach ($T['plans'][$plan]['features'] as $f) {
            $pdf->bullet($f);
        }
    } else {
        $pdf->h2($T['intro_all'], 0);
        if (!empty($c['benevole_out'])) {
            $pdf->rich($T['benevole_out'], 9);
        }
        $rows = [];
        $ids = $lots <= 9 ? ['benevole', 'essentiel', 'serenite'] : ['essentiel', 'serenite'];
        foreach ($ids as $id) {
            $grid = $D['prices'][$id];
            [$rate] = ms_rate($grid, $lots);
            $m = max($rate * $lots, (float) $grid['min']);
            $rows[] = [$T['plans'][$id]['name'], $money($rate, 2), $money($m, 2), $money($m * 12, 2)];
        }
        $pdf->table([50, 44, 40, 40], $T['compare_cols'], $rows, ['align' => ['L', 'R', 'R', 'R']]);
        $pdf->rich($T['no_setup'] . ' ' . $T['choose'], 9);
        foreach ($ids as $id) {
            $pdf->h2(str_replace('{plan}', $T['plans'][$id]['name'], $T['included']), 3);
            foreach ($T['plans'][$id]['features'] as $f) {
                $pdf->bullet($f);
            }
        }
    }

    if ($isSyndic) {
        $pdf->h2($T['extras']);
        $pdf->table([104, 70], $T['extras_cols'], $T['extras_rows'], ['size' => 8.4]);
    }
    $pdf->h2($T['conditions']);
    foreach ($T[$isSyndic ? 'cond_syndic' : 'cond_benevole'] as $line) {
        $pdf->bullet($line);
    }
    $pdf->h2($T['steps']);
    foreach ($T[$isSyndic ? 'steps_syndic' : 'steps_benevole'] as $i => $line) {
        $pdf->bullet($line, ($i + 1) . '.');
    }
    $pdf->Ln(3);
    $pdf->ensureSpace(24);
    $pdf->SetFillColor(238, 244, 251);
    $note = $T['ag_note'] . ' ' . ($c['contract'] === 'filled' ? $T['contract_filled'] : ($c['contract'] === 'both' ? $T['contract_both'] : $T['contract_model']))
        . ($T['contract_lang'] !== '' ? ' ' . $T['contract_lang'] : '');
    $pdf->SetFont('Helvetica', '', 8.6);
    $pdf->SetTextColor(...$pdf->ink);
    $pdf->MultiCell(0, 4.5, ms_t($note), 0, 'L', true);
    return $pdf->Output('S');
}

/**
 * Le contrat. $kind : 'syndic' | 'benevole' ; $vals : valeurs des balises {clé}.
 */
function ms_contract_pdf(array $D, string $kind, array $vals, string $pageLabel = 'Page {n} sur {t}', string $plan = ''): string
{
    $pdf = new MsPdf();
    $pdf->logo = __DIR__ . '/logo.jpg';
    $pdf->footerLine = $D['meta']['company_line'];
    $pdf->pageLabel = $pageLabel;
    $map = [];
    foreach ($vals as $k => $v) {
        $map['{' . $k . '}'] = (string) $v;
    }
    $fill = fn($s) => strtr($s, $map);
    $pdf->runningTitle = $fill('{titre}');
    $pdf->SetTitle($fill('{titre}'), true);
    $pdf->AddPage();
    $pdf->brandHeader([$vals['ref_line'] ?? '']);
    $prev = '';
    foreach ($D['contracts'][$kind] as $b) {
        [$type, $content] = [$b[0], $b[1]];
        // Bloc propre à une formule : absent du contrat de l'autre formule.
        $only = (isset($b[2]) && is_array($b[2])) ? ($b[2]['only'] ?? '') : '';
        if ($only !== '' && $plan !== '' && $only !== $plan) {
            continue;
        }
        if ($prev === 'li' && $type !== 'li') {
            $pdf->Ln(2);
        }
        $prev = $type;
        switch ($type) {
            case 'h1':
                $pdf->h1($fill($content));
                break;
            case 'meta':
                $pdf->meta($fill($content));
                break;
            case 'h2':
                $pdf->h2($fill($content));
                break;
            case 'p':
                $pdf->ensureSpace(12);
                $pdf->rich($fill($content));
                break;
            case 'li':
                $pdf->bullet($fill($content));
                break;
            case 'table':
                $w = $content['w'];
                $head = $content['head'];
                $rows = $content['rows'];
                if ($plan !== '' && isset($content['plancols'][$plan])) {
                    // Une seule formule : on garde la 1re colonne et celle de la formule.
                    $col = $content['plancols'][$plan];
                    $w = $content['w1'];
                    $head = [$head[0], $head[$col]];
                    $rows = array_map(fn($r) => [$r[0], $r[$col]], $rows);
                    // Une prestation absente de la formule (« Non ») n'apparaît pas.
                    $rows = array_values(array_filter($rows, fn($r) => $r[1] !== 'Non'));
                }
                if ($plan !== '' && isset($content['planrows'][$plan])) {
                    $rows = [$rows[$content['planrows'][$plan]]];
                }
                $pdf->table($w, array_map($fill, $head), array_map(fn($r) => array_map($fill, $r), $rows));
                break;
            case 'sign':
                $pdf->signatures(array_map($fill, $b[1]), array_map($fill, $b[2]), array_map($fill, $b[3]));
                break;
            case 'pagebreak':
                $pdf->AddPage();
                break;
        }
    }
    return $pdf->Output('S');
}
