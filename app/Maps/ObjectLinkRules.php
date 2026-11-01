<?php

declare(strict_types=1);

namespace JDR\Maps;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;

/**
 * What a stairs / portal / door link depends on (P9a1), checked when an object is written, for
 * SceneApplier:
 * - stairs.props.to_floor: uid of a floor of the same map, other than the floor of the stairs
 *   ("invalid");
 * - props.link.map_id: a live map of the same game ("not_found"; a map in the trash, another game
 *   or a template is refused); props.link.floor: a floor uid of that map ("not_found").
 */
final class ObjectLinkRules
{
    public function __construct(private MapState $state, private SceneStore $store)
    {
    }

    /**
     * @param array<string, mixed> $object API form (floor = floor id)
     * @param string               $field  field of the object in the request ("ops.3.object", "ops.3.patch")
     * @throws ValidationException
     */
    public function check(array $object, string $field): void
    {
        $props = $object['props'];
        if ($object['type'] === 'stairs') {
            $own = null;
            foreach ($this->state->floors as $floor) {
                if ($floor['id'] === (int) $object['floor']) {
                    $own = $floor['uid'];
                }
            }
            $known = array_column($this->state->floors, 'uid');
            if (!in_array($props['to_floor'], $known, true) || $props['to_floor'] === $own) {
                throw new ValidationException('', [$field . '.props.to_floor' => 'invalid']);
            }
        }
        $link = $props['link'] ?? null;
        if (is_array($link) && is_int($link['map_id'] ?? null)) {
            $floors = $this->store->linkFloors($link['map_id']);
            if ($floors === null) {
                throw new ValidationException('', [$field . '.props.link.map_id' => 'not_found']);
            }
            if (is_string($link['floor'] ?? null) && !in_array($link['floor'], $floors, true)) {
                throw new ValidationException('', [$field . '.props.link.floor' => 'not_found']);
            }
        }
    }
}
