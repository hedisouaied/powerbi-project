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
    protected $signature = 'mc:import {--check : only run the checks}';

    protected $description = 'Import the Mission Control CSV files and verify relationships and totals';

    public function handle(): int
    {
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
            $this->line(sprintf('  %-26s %6d rows', $name, $n));
        }
        DB::statement('SET FOREIGN_KEY_CHECKS=1');
        MissionData::bump();
    }

    private function check(): bool
    {
        $ok = true;
        $orphans = 0;
        foreach (config('mission_control.relationships') as $r) {
            $n = DB::table($r['table'].' as a')->whereNotNull('a.'.$r['column'])
                ->whereNotExists(fn ($q) => $q->from($r['refTable'].' as b')->whereColumn('b.'.$r['refColumn'], 'a.'.$r['column']))->count();
            if ($n && $r['refTable'] === 'dim_date' && ! $r['activeInPowerBI']) {
                $this->line("  outside the calendar (indexed link, as in Power BI): {$r['table']}.{$r['column']}: {$n}");
            } elseif ($n) {
                $orphans += $n;
                $ok = false;
                $this->error("  orphan rows: {$r['table']}.{$r['column']} -> {$r['refTable']}: {$n}");
            }
        }
        $this->info('relationships: '.count(config('mission_control.relationships')).' checked, '.$orphans.' orphan rows on enforced foreign keys');
        // same reference values as the Power BI model (exercice3 CLAUDE.md)
        $rev = (float) DB::table('sales_orders')->whereIn('order_status', ['Completed', 'Processing'])->sum('net_amount_tnd');
        $gross = (float) DB::table('sales_orders')->whereIn('order_status', ['Completed', 'Processing'])->sum('gross_amount_tnd');
        $inc = DB::table('incidents')->whereIn('incident_status', ['Open', 'Investigating'])->count();
        $alerts = DB::table('alerts')->whereIn('alert_status', ['New', 'In Progress', 'Acknowledged'])->count();
        $checks = [
            ['net revenue', round($rev, 2), 61746871.96],
            ['gross revenue', round($gross, 2), 73550210.26],
            ['open incidents', $inc, 120],
            ['open alerts', $alerts, 210],
        ];
        foreach ($checks as [$label, $got, $want]) {
            $match = abs($got - $want) < 0.01;
            $ok = $ok && $match;
            $this->line(sprintf('  %-16s %16s  %s', $label, number_format($got, 2, '.', ','), $match ? 'matches Power BI' : "EXPECTED {$want}"));
        }

        return $ok;
    }
}
