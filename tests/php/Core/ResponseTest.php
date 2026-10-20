<?php

declare(strict_types=1);

namespace JDR\Tests\Core;

use JDR\Core\Ids;
use JDR\Core\Response;
use PHPUnit\Framework\TestCase;

final class ResponseTest extends TestCase
{
    public function testSuccessEnvelope(): void
    {
        $response = Response::ok(['name' => 'Crypte'], ['next_cursor' => null]);
        self::assertSame(200, $response->status());
        self::assertSame('application/json; charset=utf-8', $response->header('content-type'));
        self::assertSame(
            '{"ok":true,"data":{"name":"Crypte"},"meta":{"next_cursor":null}}',
            $response->body(),
        );
    }

    public function testEmptyMetaAndFieldsAreObjects(): void
    {
        self::assertSame('{"ok":true,"data":[],"meta":{}}', Response::ok([])->body());
        self::assertSame(
            '{"ok":false,"error":{"code":"not_found","message":"Introuvable","fields":{}}}',
            Response::error('not_found', 'Introuvable', 404)->body(),
        );
    }

    public function testErrorEnvelopeWithFieldsAndHeaders(): void
    {
        $response = Response::error('rate_limited', 'Trop', 429, ['email' => 'x'], ['Retry-After' => '30']);
        self::assertSame(429, $response->status());
        self::assertSame('30', $response->header('Retry-After'));
        self::assertSame(
            ['ok' => false, 'error' => ['code' => 'rate_limited', 'message' => 'Trop', 'fields' => ['email' => 'x']]],
            $response->payload(),
        );
    }

    public function testIdsAreSerializedAsStrings(): void
    {
        $response = Response::ok([
            'id' => 9007199254740993,
            'game_id' => 12,
            'user_ids' => [1, 2],
            'count' => 3,
            'items' => [['id' => 5, 'owner_id' => null, 'size' => 2]],
        ]);
        self::assertSame(
            '{"ok":true,"data":{"id":"9007199254740993","game_id":"12","user_ids":["1","2"],"count":3,'
            . '"items":[{"id":"5","owner_id":null,"size":2}]},"meta":{}}',
            $response->body(),
        );
    }

    public function testIdsHelperLeavesScalarsAlone(): void
    {
        self::assertSame('x', Ids::stringify('x'));
        self::assertSame(['uid' => 4, 'valid' => true], Ids::stringify(['uid' => 4, 'valid' => true]));
    }

    public function testUnicodeAndSlashesAreNotEscaped(): void
    {
        self::assertStringContainsString('"é/è"', Response::ok('é/è')->body());
    }

    public function testHeadersAreReplacedCaseInsensitively(): void
    {
        $response = Response::text('x');
        $response->withHeader('content-type', 'text/csv');
        self::assertSame(['content-type' => 'text/csv'], $response->headers());
    }

    public function testHeaderInjectionIsRefused(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        Response::text('x')->withHeader('X-Test', "a\r\nSet-Cookie: x=1");
    }

    public function testRedirectAndNoContent(): void
    {
        self::assertSame('/install.php', Response::redirect('/install.php')->header('Location'));
        self::assertSame(302, Response::redirect('/install.php')->status());
        self::assertSame(204, Response::noContent()->status());
    }
}
