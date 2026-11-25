<?php

use App\Support\MissionData;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The 32 Mission Control tables (31 business tables + dim_date) and their 61 relationships, built from
 * config/mission_control.php (generated from exercice3). Every relationship of the Power BI model is a real
 * foreign key here, except inactive role-playing date links to dim_date (indexed, not enforced — see isSoft()).
 */
return new class extends Migration
{
    public function up(): void
    {
        $cfg = config('mission_control');
        foreach ($cfg['tables'] as $name => $t) {
            Schema::create($name, function (Blueprint $table) use ($t) {
                foreach ($t['columns'] as $c) {
                    $col = $c['name'];
                    $isPk = $col === $t['primaryKey'];
                    $def = match ($c['type']) {
                        'S' => $c['max'] > 190 ? $table->text($col) : $table->string($col, MissionData::stringLength($col, $c['max'])),
                        'D' => $table->date($col),
                        'T' => $table->dateTime($col),
                        'I' => $table->integer($col),
                        'C' => $table->decimal($col, 15, 2),
                        'N', 'P' => $table->double($col),
                        'B' => $table->boolean($col),
                        'G' => $table->date($col)->storedAs('DATE(start_datetime)'),
                    };
                    if ($isPk) {
                        $def->primary();
                    } elseif ($c['type'] !== 'G') {
                        $def->nullable();
                    }
                }
            });
        }
        foreach ($cfg['relationships'] as $i => $r) {
            Schema::table($r['table'], function (Blueprint $table) use ($r, $i) {
                if (self::isSoft($r)) {
                    $table->index($r['column'], 'ix_mc_'.str_pad((string) $i, 2, '0', STR_PAD_LEFT));

                    return;
                }
                $table->foreign($r['column'], 'fk_mc_'.str_pad((string) $i, 2, '0', STR_PAD_LEFT))
                    ->references($r['refColumn'])->on($r['refTable'])
                    ->restrictOnDelete();
            });
        }
    }

    /**
     * Role-playing dates that were inactive in Power BI (e.g. promised delivery, settlement, mission target) can fall outside
     * the calendar (the planted O00008 anomaly does): they are indexed links, not enforced foreign keys.
     *
     * @param  array{table: string, column: string, refTable: string, refColumn: string, activeInPowerBI: bool}  $r
     */
    public static function isSoft(array $r): bool
    {
        return $r['refTable'] === 'dim_date' && ! $r['activeInPowerBI'];
    }

    public function down(): void
    {
        Schema::disableForeignKeyConstraints();
        foreach (array_keys(config('mission_control.tables')) as $name) {
            Schema::dropIfExists($name);
        }
        Schema::enableForeignKeyConstraints();
    }
};
