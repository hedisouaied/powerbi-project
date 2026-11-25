<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Per-user dashboard state: preferences (theme, accent, layout, KPIs, watchlist, saved scenarios…) and workspace
 * extras (acknowledged anomalies, reviewed checks, personal activity), stored as JSON on the users row.
 */
class PreferenceController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return response()->json(['preferences' => $request->user()->preferences ?? (object) [], 'workspace' => $request->user()->workspace ?? (object) []]);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate(['preferences' => ['sometimes', 'array'], 'workspace' => ['sometimes', 'array']]);
        foreach (['preferences', 'workspace'] as $key) {
            if (array_key_exists($key, $data) && strlen((string) json_encode($data[$key])) > 500_000) {
                return response()->json(['message' => "{$key} est trop volumineux."], 422);
            }
        }
        $request->user()->fill($data)->save();

        return response()->json(['ok' => true]);
    }
}
