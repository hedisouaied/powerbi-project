<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

/**
 * Creates the public demo account if it does not exist (used on deploy so visitors can sign in without registering).
 * Credentials come from DEMO_EMAIL / DEMO_PASSWORD, defaulting to the documented demo account.
 */
class EnsureDemoUser extends Command
{
    protected $signature = 'mc:demo-user';

    protected $description = 'Create the demo account if it is missing';

    public function handle(): int
    {
        $email = (string) env('DEMO_EMAIL', 'demo@missioncontrol.local');
        if (User::where('email', $email)->exists()) {
            $this->info("Demo account {$email} already exists.");

            return self::SUCCESS;
        }
        User::create(['name' => 'Demo Analyst', 'email' => $email, 'password' => (string) env('DEMO_PASSWORD', 'Demo12345')]);
        $this->info("Demo account {$email} created.");

        return self::SUCCESS;
    }
}
