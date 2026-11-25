<?php

namespace App\Console\Commands;

use App\Support\MissionData;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Loads the 32 CSV files (database/data, copied from exercice3) into MySQL, then checks every foreign key
 * and the reference values that Power BI shows. Run: php artisan mc:import
 */
class ImportMissionControl extends Command
{
    protected $signature = 'mc:import {--check : only run the checks} {--if-empty : import only when the database has no orders yet (safe on every deploy)}';

    protected $description = 'Importe les fichiers CSV Mission Control (traduits en français) et vérifie relations et totaux';

    public function handle(): int
    {
        if ($this->option('if-empty') && DB::table('sales_orders')->exists() && $this->hasFrenchData()) {
            $this->info('Données déjà chargées : import ignoré (les modifications des utilisateurs sont conservées).');

            return self::SUCCESS;
        }
        if (! $this->option('check')) {
            $this->import();
        }

        return $this->check() ? self::SUCCESS : self::FAILURE;
    }

    private function import(): void
    {
        DB::statement('SET FOREIGN_KEY_CHECKS=0');
        foreach (MissionData::tables() as $name => $t) {
            DB::table($name)->delete();
            $fh = fopen(database_path("data/{$name}.csv"), 'r');
            $head = array_map(fn ($h) => trim(preg_replace('/^\xEF\xBB\xBF/', '', $h)), fgetcsv($fh, escape: ''));
            $types = MissionData::types($name);
            $batch = [];
            $n = 0;
            while (($line = fgetcsv($fh, escape: '')) !== false) {
                if ($line === [null]) {
                    continue;
                }
                $row = [];
                foreach ($head as $i => $col) {
                    if (! isset($types[$col])) {
                        continue;
                    }
                    $v = trim(preg_replace('/\s+/', ' ', (string) ($line[$i] ?? '')));
                    $row[$col] = match (true) {
                        $types[$col] === 'B' => in_array(strtolower($v), ['true', '1', 'yes'], true) ? 1 : 0,
                        $v === '' => null,
                        $types[$col] === 'T' => substr(str_replace('T', ' ', $v), 0, 19),
                        $types[$col] === 'S' => $this->translate("{$name}.{$col}", $v),
                        default => $v,
                    };
                }
                $batch[] = $row;
                $n++;
                if (count($batch) === 500) {
                    DB::table($name)->insert($batch);
                    $batch = [];
                }
            }
            if ($batch) {
                DB::table($name)->insert($batch);
            }
            fclose($fh);
            $this->line(sprintf('  %-26s %6d lignes', $name, $n));
        }
        DB::statement('SET FOREIGN_KEY_CHECKS=1');
        MissionData::bump();
    }

    /** @var array{keep: list<string>, patterns: list<array{0: string, 1: string}>, values: array<string, string>}|null */
    private ?array $fr = null;

    /**
     * English CSV text -> French (database/data/translations_fr.json): identifiers and kept columns stay as they are,
     * categories use one shared dictionary (so the dashboard can compare values), numbered texts use patterns.
     */
    private function translate(string $column, string $value): string
    {
        $this->fr ??= json_decode((string) file_get_contents(database_path('data/translations_fr.json')), true);
        if ($value === '' || str_ends_with($column, '_id') || in_array($column, $this->fr['keep'], true)) {
            return $value;
        }
        if (array_key_exists($value, $this->fr['values'])) {
            return $this->fr['values'][$value];
        }
        foreach ($this->fr['patterns'] as [$pattern, $replacement]) {
            if (preg_match('/'.$pattern.'/u', $value)) {
                return (string) preg_replace('/'.$pattern.'/u', $replacement, $value);
            }
        }

        return $value;
    }

    /** True when the database already holds the French data (used by --if-empty to re-import English data once). */
    private function hasFrenchData(): bool
    {
        return DB::table('departments')->where('department_name', 'Ventes')->exists();
    }

    private function check(): bool
    {
        $ok = true;
        $orphans = 0;
        foreach (config('mission_control.relationships') as $r) {
            $n = DB::table($r['table'].' as a')->whereNotNull('a.'.$r['column'])
                ->whereNotExists(fn ($q) => $q->from($r['refTable'].' as b')->whereColumn('b.'.$r['refColumn'], 'a.'.$r['column']))->count();
            if ($n && $r['refTable'] === 'dim_date' && ! $r['activeInPowerBI']) {
                $this->line("  hors calendrier (lien indexé, comme dans Power BI): {$r['table']}.{$r['column']}: {$n}");
            } elseif ($n) {
                $orphans += $n;
                $ok = false;
                $this->error("  lignes orphelines : {$r['table']}.{$r['column']} -> {$r['refTable']}: {$n}");
            }
        }
        $this->info('relations : '.count(config('mission_control.relationships')).' vérifiées, '.$orphans.' ligne(s) orpheline(s) sur les clés étrangères');
        // same reference values as the Power BI model (exercice3 CLAUDE.md)
        $rev = (float) DB::table('sales_orders')->whereIn('order_status', ['Terminé', 'En traitement'])->sum('net_amount_tnd');
        $gross = (float) DB::table('sales_orders')->whereIn('order_status', ['Terminé', 'En traitement'])->sum('gross_amount_tnd');
        $inc = DB::table('incidents')->whereIn('incident_status', ['Ouvert', 'En investigation'])->count();
        $alerts = DB::table('alerts')->whereIn('alert_status', ['Nouveau', 'En cours', 'Pris en compte'])->count();
        $checks = [
            ['CA net', round($rev, 2), 61746871.96],
            ['CA brut', round($gross, 2), 73550210.26],
            ['incidents ouverts', $inc, 120],
            ['alertes ouvertes', $alerts, 210],
        ];
        foreach ($checks as [$label, $got, $want]) {
            $match = abs($got - $want) < 0.01;
            $ok = $ok && $match;
            $this->line(sprintf('  %-16s %16s  %s', $label, number_format($got, 2, ',', ' '), $match ? 'identique à Power BI' : "ATTENDU {$want}"));
        }

        return $ok;
    }
}
