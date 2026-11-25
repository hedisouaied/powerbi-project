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

    protected $description = 'Crée le compte de démonstration s\'il manque';

    public function handle(): int
    {
        $email = (string) env('DEMO_EMAIL', 'demo@missioncontrol.local');
        User::where('email', $email)->where('name', 'Demo Analyst')->update(['name' => 'Analyste Démo']);
        if (User::where('email', $email)->exists()) {
            $this->info("Le compte de démonstration {$email} existe déjà.");

            return self::SUCCESS;
        }
        User::create(['name' => 'Analyste Démo', 'email' => $email, 'password' => (string) env('DEMO_PASSWORD', 'Demo12345')]);
        $this->info("Compte de démonstration {$email} créé.");

        return self::SUCCESS;
    }
}
