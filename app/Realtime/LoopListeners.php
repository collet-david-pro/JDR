<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

use JDR\Core\Container;
use JDR\Core\Logger;
use JDR\Domain\Displays\DisplayWatch;
use JDR\Domain\Sessions\PresenceService;

/**
 * The LoopListener services called by the real-time loops. CLASSES lists the services resolved
 * from the container (P6b adds JDR\Domain\Sessions\PresenceService, P7b the screen revalidation
 * JDR\Domain\Displays\DisplayWatch); add() registers more
 * (tests). A listener that throws is logged and ignored: presence never breaks a stream.
 */
final class LoopListeners
{
    /** @var list<class-string<LoopListener>> */
    public const CLASSES = [PresenceService::class, DisplayWatch::class];

    /** @var list<LoopListener>|null */
    private ?array $listeners = null;

    public function __construct(private Container $container, private Logger $logger)
    {
    }

    public function add(LoopListener $listener): void
    {
        $this->listeners = [...$this->all(), $listener];
    }

    /**
     * @return list<LoopListener>
     */
    public function all(): array
    {
        if ($this->listeners === null) {
            $this->listeners = [];
            foreach (self::CLASSES as $class) {
                $service = $this->container->get($class);
                if ($service instanceof LoopListener) {
                    $this->listeners[] = $service;
                }
            }
        }

        return $this->listeners;
    }

    public function tick(Subscription $sub, float $now): void
    {
        foreach ($this->all() as $listener) {
            try {
                $listener->onLoopTick($sub, $now);
            } catch (\Throwable $e) {
                $this->logger->warning('Realtime loop listener failed', [
                    'listener' => $listener::class,
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }
}
