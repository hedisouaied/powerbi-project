<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Table metadata (config/mission_control.php) and the columnar feeds {c: columns, r: rows} the dashboard reads —
 * the same format and columns as the Power BI "Feed <table>" measures, so the dashboard engine is shared unchanged.
 * Salary (employees.monthly_salary_tnd) is never part of a feed.
 */
class MissionData
{
    public static function tables(): array
    {
        return config('mission_control.tables');
    }

    public static function table(string $name): ?array
    {
        return self::tables()[$name] ?? null;
    }

    public static function types(string $name): array
    {
        $out = [];
        foreach (self::table($name)['columns'] as $c) {
            $out[$c['name']] = $c['type'];
        }

        return $out;
    }

    /** Converts a DB/CSV value to the feed's JSON value for a column type. */
    public static function value(mixed $v, string $type): mixed
    {
        if ($type === 'B') {
            return (bool) $v;
        }
        if ($v === null || $v === '') {
            return null;
        }

        return match ($type) {
            'D', 'G' => substr((string) $v, 0, 10),
            'T' => substr(str_replace('T', ' ', (string) $v), 0, 16),
            'I' => (int) $v,
            'N', 'C', 'P' => round((float) $v, 4) + 0,
            default => (string) $v,
        };
    }

    /** Column width for text: identifiers stay compact, free text gets room for edits made in the app. */
    public static function stringLength(string $column, int $longest): int
    {
        return str_ends_with($column, '_id') ? max(32, (int) ceil($longest * 1.5)) : 191;
    }

    public static function version(): int
    {
        return (int) Cache::get('mc.feeds.version', 1);
    }

    public static function bump(): void
    {
        Cache::forever('mc.feeds.version', self::version() + 1);
    }

    /** All feeds, cached until the next write. */
    public static function feeds(): array
    {
        return Cache::rememberForever('mc.feeds.'.self::version(), function () {
            $out = [];
            foreach (self::tables() as $name => $t) {
                if ($t['feed']) {
                    $out[$name] = self::feed($name);
                }
            }

            return $out;
        });
    }

    public static function feed(string $name): array
    {
        $t = self::table($name);
        $types = self::types($name);
        $cols = $t['feedColumns'];
        $rows = DB::table($name)->select($cols)->orderBy($t['primaryKey'])->get();
        $r = [];
        foreach ($rows as $row) {
            $line = [];
            foreach ($cols as $c) {
                $line[] = self::value($row->{$c}, $types[$c]);
            }
            $r[] = $line;
        }

        return ['c' => $cols, 'r' => $r];
    }

    /** Converts incoming JSON values to DB values for a table, keeping only known non-generated columns. */
    public static function toDb(string $name, array $input): array
    {
        $types = self::types($name);
        $out = [];
        foreach ($input as $k => $v) {
            if (! isset($types[$k]) || $types[$k] === 'G') {
                continue;
            }
            $type = $types[$k];
            if ($type === 'B') {
                $out[$k] = filter_var($v, FILTER_VALIDATE_BOOLEAN) ? 1 : 0;
            } elseif ($v === null || $v === '') {
                $out[$k] = null;
            } elseif ($type === 'D') {
                $out[$k] = substr((string) $v, 0, 10);
            } elseif ($type === 'T') {
                $out[$k] = str_replace('T', ' ', substr((string) $v, 0, 16)).':00';
            } elseif (in_array($type, ['I'], true)) {
                $out[$k] = (int) $v;
            } elseif (in_array($type, ['N', 'C', 'P'], true)) {
                $out[$k] = (float) $v;
            } else {
                $out[$k] = trim((string) $v);
            }
        }

        return $out;
    }

    /** Validation rules for a table's columns (type checks; the primary key is required on create). */
    public static function rules(string $name, bool $create): array
    {
        $t = self::table($name);
        $rules = [];
        foreach ($t['columns'] as $c) {
            if ($c['type'] === 'G') {
                continue;
            }
            $base = match ($c['type']) {
                'D' => ['date'],
                'T' => ['date'],
                'I' => ['integer'],
                'N', 'C', 'P' => ['numeric'],
                'B' => ['boolean'],
                default => ['string', 'max:'.($c['max'] > 190 ? 5000 : self::stringLength($c['name'], $c['max']))],
            };
            $req = $c['name'] === $t['primaryKey'] && $create ? ['required'] : ['sometimes', 'nullable'];
            $rules[$c['name']] = array_merge($req, $base);
        }

        return $rules;
    }
}
