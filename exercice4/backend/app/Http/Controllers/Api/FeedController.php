<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\MissionData;
use Illuminate\Http\JsonResponse;

/**
 * The dashboard's data: the 31 tables as columnar feeds (same columns and format as the Power BI feed measures).
 */
class FeedController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json([
            'version' => MissionData::version(),
            'reference_date' => config('mission_control.reference_date'),
            'editable' => array_keys(array_filter(MissionData::tables(), fn (array $t): bool => $t['editable'])),
            'feeds' => MissionData::feeds(),
        ]);
    }
}
