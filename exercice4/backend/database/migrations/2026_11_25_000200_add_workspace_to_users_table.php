<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Per-user dashboard preferences (theme, layout, KPIs, scenarios…) and workspace extras (acknowledgements, reviewed checks, activity). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('role', 20)->default('analyst')->after('email');
            $table->json('preferences')->nullable();
            $table->json('workspace')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['role', 'preferences', 'workspace']);
        });
    }
};
