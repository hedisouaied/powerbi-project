<?php

namespace Tests\Feature;

use Tests\TestCase;

class ExampleTest extends TestCase
{
    public function test_the_home_page_redirects_to_the_dashboard(): void
    {
        $this->get('/')->assertRedirect('/app/');
    }

    public function test_the_api_health_check_answers(): void
    {
        $this->getJson('/api/health')->assertOk()->assertJsonPath('ok', true);
    }
}
