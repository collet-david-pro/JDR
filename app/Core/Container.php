<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

/**
 * Minimal service container: registered factories, shared instances,
 * and constructor autowiring by class type for everything else.
 */
final class Container
{
    /** @var array<string, \Closure(Container): object> */
    private array $factories = [];

    /** @var array<string, object> */
    private array $instances = [];

    /**
     * @param \Closure(Container): object $factory
     */
    public function set(string $id, \Closure $factory): void
    {
        $this->factories[$id] = $factory;
        unset($this->instances[$id]);
    }

    public function instance(string $id, object $service): void
    {
        $this->instances[$id] = $service;
    }

    public function has(string $id): bool
    {
        return isset($this->instances[$id]) || isset($this->factories[$id]);
    }

    /**
     * @template T of object
     * @param class-string<T>|string $id
     * @return ($id is class-string<T> ? T : object)
     */
    public function get(string $id): object
    {
        if (isset($this->instances[$id])) {
            return $this->instances[$id];
        }
        $service = isset($this->factories[$id]) ? ($this->factories[$id])($this) : $this->autowire($id);

        return $this->instances[$id] = $service;
    }

    private function autowire(string $class): object
    {
        if (!class_exists($class)) {
            throw new \RuntimeException('Unknown service: ' . $class);
        }
        $reflection = new \ReflectionClass($class);
        if (!$reflection->isInstantiable()) {
            throw new \RuntimeException('Service is not instantiable: ' . $class);
        }
        $constructor = $reflection->getConstructor();
        if ($constructor === null) {
            return $reflection->newInstance();
        }
        $args = [];
        foreach ($constructor->getParameters() as $param) {
            $type = $param->getType();
            if ($type instanceof \ReflectionNamedType && !$type->isBuiltin()) {
                $name = $type->getName();
                if ($this->has($name) || !$param->isDefaultValueAvailable()) {
                    $args[] = $this->get($name);
                    continue;
                }
            }
            if ($param->isDefaultValueAvailable()) {
                $args[] = $param->getDefaultValue();
                continue;
            }
            throw new \RuntimeException(sprintf('Cannot resolve $%s of %s.', $param->getName(), $class));
        }

        return $reflection->newInstanceArgs($args);
    }
}
