<?php

declare(strict_types=1);

namespace JDR\Tests\Core;

use JDR\Core\Clock;
use JDR\Core\Container;
use JDR\Core\I18n;
use JDR\Core\SystemStatus;
use JDR\Core\View;
use JDR\Http\Controllers\SystemController;
use JDR\Http\Shell;
use PHPUnit\Framework\TestCase;

final class ContainerTest extends TestCase
{
    public function testFactoriesAreSharedAndAutowiringResolvesDependencies(): void
    {
        $c = new Container();
        $status = SystemStatus::fixed('ok', '0001');
        $c->set(SystemStatus::class, static fn () => $status);
        // Scalar constructor arguments are never autowired: registered as App::create() does.
        $c->set(Shell::class, static fn () => new Shell(sys_get_temp_dir(), new View(I18n::forLocale())));
        $controller = $c->get(SystemController::class);
        self::assertInstanceOf(SystemController::class, $controller);
        self::assertSame($controller, $c->get(SystemController::class));
        self::assertInstanceOf(Clock::class, $c->get(Clock::class));
    }

    public function testUnknownServiceFails(): void
    {
        $this->expectException(\RuntimeException::class);
        (new Container())->get('No\\Such\\Service');
    }
}
