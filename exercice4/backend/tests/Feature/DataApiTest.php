<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class DataApiTest extends TestCase
{
    use RefreshDatabase;

    private string $token;

    protected function setUp(): void
    {
        parent::setUp();
        Artisan::call('mc:import');
        $this->token = User::factory()->create(['name' => 'Test Analyst'])->createToken('dashboard')->plainTextToken;
    }

    public function test_import_matches_the_power_bi_reference_values(): void
    {
        $this->assertSame(0, Artisan::call('mc:import', ['--check' => true]));
        $this->assertSame(1800, DB::table('sales_orders')->count());
        $this->assertSame(3560, DB::table('sales_order_items')->count());
    }

    public function test_feeds_return_31_tables_in_columnar_format_without_salary(): void
    {
        $response = $this->withToken($this->token)->getJson('/api/feeds')->assertOk();

        $feeds = $response->json('feeds');
        $this->assertCount(31, $feeds);
        $this->assertSame(['c', 'r'], array_keys($feeds['sales_orders']));
        $this->assertCount(1800, $feeds['sales_orders']['r']);
        $this->assertNotContains('monthly_salary_tnd', $feeds['employees']['c']);
        $first = array_combine($feeds['sales_orders']['c'], $feeds['sales_orders']['r'][3]);
        $this->assertSame('O00004', $first['order_id']);
        $this->assertEquals(99999, $first['gross_amount_tnd']);
    }

    public function test_a_task_can_be_created_updated_and_deleted_and_is_audited(): void
    {
        $api = $this->withToken($this->token);
        $task = ['task_id' => 'T9001', 'project_id' => 'PR001', 'department_id' => 'D01', 'assignee_employee_id' => 'E001', 'task_title' => 'Prepare Q4 board review',
            'task_status' => 'To Do', 'priority' => 'High', 'created_date' => '2026-11-22', 'due_date' => '2026-11-29', 'task_type' => 'Operational'];

        $api->postJson('/api/tables/tasks', $task)->assertCreated()->assertJsonPath('row.task_title', 'Prepare Q4 board review');
        $api->patchJson('/api/tables/tasks/T9001', ['task_status' => 'In Progress'])->assertOk()->assertJsonPath('row.task_status', 'In Progress');
        $this->assertDatabaseHas('activity_log', ['module_name' => 'tasks', 'action_type' => 'Updated']);
        $api->deleteJson('/api/tables/tasks/T9001')->assertOk();
        $this->assertDatabaseMissing('tasks', ['task_id' => 'T9001']);
    }

    public function test_feeds_reflect_writes(): void
    {
        $api = $this->withToken($this->token);
        $before = $api->getJson('/api/feeds')->json('version');
        $api->patchJson('/api/tables/tasks/T0001', ['task_status' => 'Done'])->assertOk();
        $after = $api->getJson('/api/feeds');

        $this->assertGreaterThan($before, $after->json('version'));
        $feed = $after->json('feeds.tasks');
        $row = array_combine($feed['c'], $feed['r'][0]);
        $this->assertSame('Done', $row['task_status']);
    }

    public function test_foreign_keys_are_enforced_and_read_only_tables_are_protected(): void
    {
        $api = $this->withToken($this->token);
        $api->postJson('/api/tables/tasks', ['task_id' => 'T9002', 'project_id' => 'NOPE', 'task_title' => 'Broken link'])->assertUnprocessable();
        $api->postJson('/api/tables/sales_orders', ['order_id' => 'O99999'])->assertNotFound();
        $api->postJson('/api/tables/tasks', ['task_id' => 'T0001'])->assertStatus(409);
    }
}
