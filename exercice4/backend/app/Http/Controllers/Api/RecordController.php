<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\MissionData;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Create / update / delete rows of the editable tables (tasks, calendar events, approvals, decisions, comments,
 * notifications, cases, alerts, incidents, products, activity log). Every change is written to MySQL and
 * recorded in activity_log with the signed-in user.
 */
class RecordController extends Controller
{
    public function store(Request $request, string $table): JsonResponse
    {
        $meta = $this->editable($table);
        $data = MissionData::toDb($table, $request->validate(MissionData::rules($table, true)));
        if (DB::table($table)->where($meta['primaryKey'], $data[$meta['primaryKey']])->exists()) {
            return response()->json(['message' => "{$data[$meta['primaryKey']]} already exists."], 409);
        }

        return $this->write($request, $table, 'Created', (string) $data[$meta['primaryKey']], fn () => DB::table($table)->insert($data));
    }

    public function update(Request $request, string $table, string $id): JsonResponse
    {
        $meta = $this->editable($table);
        $data = MissionData::toDb($table, $request->validate(MissionData::rules($table, false)));
        unset($data[$meta['primaryKey']]);
        abort_unless(DB::table($table)->where($meta['primaryKey'], $id)->exists(), 404);

        return $this->write($request, $table, 'Updated', $id, fn () => $data ? DB::table($table)->where($meta['primaryKey'], $id)->update($data) : 0);
    }

    public function destroy(Request $request, string $table, string $id): JsonResponse
    {
        $meta = $this->editable($table);
        abort_unless(DB::table($table)->where($meta['primaryKey'], $id)->exists(), 404);

        return $this->write($request, $table, 'Deleted', $id, fn () => DB::table($table)->where($meta['primaryKey'], $id)->delete());
    }

    /**
     * @return array{primaryKey: string, editable: bool}
     */
    private function editable(string $table): array
    {
        $meta = MissionData::table($table);
        abort_unless($meta && $meta['editable'], 404, 'This table is read-only.');

        return $meta;
    }

    private function write(Request $request, string $table, string $action, string $id, callable $change): JsonResponse
    {
        try {
            DB::transaction(function () use ($request, $table, $action, $id, $change): void {
                $change();
                if ($table !== 'activity_log') {
                    DB::table('activity_log')->insert([
                        'activity_id' => 'WEB'.now()->format('ymdHisv').random_int(10, 99),
                        'activity_date' => now()->toDateString(),
                        'employee_id' => null,
                        'action_type' => $action,
                        'module_name' => $table,
                        'result' => 'Success',
                        'event_details' => "{$action} {$id} by {$request->user()->name} (web app)",
                    ]);
                }
            });
        } catch (QueryException $e) {
            return response()->json(['message' => 'The change breaks a relationship or a constraint: '.$e->errorInfo[2]], 422);
        }
        MissionData::bump();
        $meta = MissionData::table($table);
        $row = DB::table($table)->where($meta['primaryKey'], $id)->first();

        return response()->json(['ok' => true, 'version' => MissionData::version(), 'row' => $row], $action === 'Created' ? 201 : 200);
    }
}
