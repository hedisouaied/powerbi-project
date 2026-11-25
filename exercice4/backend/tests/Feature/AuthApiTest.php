<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_user_can_register_and_receives_a_token(): void
    {
        $response = $this->postJson('/api/auth/register', [
            'name' => 'Amira Ben Salah', 'email' => 'amira@example.com', 'password' => 'secret123', 'password_confirmation' => 'secret123',
        ]);

        $response->assertCreated()->assertJsonPath('user.email', 'amira@example.com')->assertJsonStructure(['token']);
        $this->assertDatabaseHas('users', ['email' => 'amira@example.com']);
    }

    public function test_registration_validates_input(): void
    {
        $this->postJson('/api/auth/register', ['name' => '', 'email' => 'not-an-email', 'password' => 'short', 'password_confirmation' => 'other'])
            ->assertUnprocessable()->assertJsonValidationErrors(['name', 'email', 'password']);
    }

    public function test_login_with_correct_and_wrong_password(): void
    {
        User::factory()->create(['email' => 'sami@example.com', 'password' => 'secret123']);

        $this->postJson('/api/auth/login', ['email' => 'sami@example.com', 'password' => 'secret123'])->assertOk()->assertJsonStructure(['token', 'user' => ['name']]);
        $this->postJson('/api/auth/login', ['email' => 'sami@example.com', 'password' => 'wrong-pass1'])->assertUnprocessable()->assertJsonValidationErrors(['email']);
    }

    public function test_protected_routes_require_a_token_and_logout_revokes_it(): void
    {
        $this->getJson('/api/feeds')->assertUnauthorized();
        $this->getJson('/api/auth/me')->assertUnauthorized();

        $user = User::factory()->create();
        $token = $user->createToken('dashboard')->plainTextToken;
        $this->withToken($token)->getJson('/api/auth/me')->assertOk()->assertJsonPath('user.id', $user->id);
        $this->withToken($token)->postJson('/api/auth/logout')->assertOk();
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_preferences_are_saved_per_user(): void
    {
        $user = User::factory()->create();
        $token = $user->createToken('dashboard')->plainTextToken;

        $this->withToken($token)->putJson('/api/me/preferences', ['preferences' => ['theme' => 'light', 'accent' => 'teal']])->assertOk();
        $this->withToken($token)->getJson('/api/me/preferences')->assertOk()->assertJsonPath('preferences.theme', 'light');
    }
}
