<?php

use Illuminate\Support\Facades\Route;

Route::redirect('/', '/app/')->name('home');

/*
 * The React dashboard (built by `npm run build` in exercice4/frontend into public/app). Every client-side path
 * returns the same index.html; static assets under public/app/assets are served directly.
 */
Route::get('/app/{path?}', function () {
    $index = public_path('app/index.html');
    abort_unless(is_file($index), 503, 'The frontend is not built yet: run npm run build in exercice4/frontend.');

    return response()->file($index, ['Cache-Control' => 'no-cache']);
})->where('path', '.*')->name('dashboard');
