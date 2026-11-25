<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\FeedController;
use App\Http\Controllers\Api\PreferenceController;
use App\Http\Controllers\Api\RecordController;
use Illuminate\Support\Facades\Route;

Route::get('/health', fn () => ['ok' => true, 'app' => config('app.name')])->name('health');

Route::middleware('throttle:10,1')->group(function () {
    Route::post('/auth/register', [AuthController::class, 'register'])->name('auth.register');
    Route::post('/auth/login', [AuthController::class, 'login'])->name('auth.login');
});

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/auth/me', [AuthController::class, 'me'])->name('auth.me');
    Route::post('/auth/logout', [AuthController::class, 'logout'])->name('auth.logout');
    Route::get('/feeds', [FeedController::class, 'index'])->name('feeds');
    Route::get('/me/preferences', [PreferenceController::class, 'show'])->name('preferences.show');
    Route::put('/me/preferences', [PreferenceController::class, 'update'])->name('preferences.update');
    Route::post('/tables/{table}', [RecordController::class, 'store'])->name('records.store');
    Route::patch('/tables/{table}/{id}', [RecordController::class, 'update'])->name('records.update');
    Route::delete('/tables/{table}/{id}', [RecordController::class, 'destroy'])->name('records.destroy');
});
