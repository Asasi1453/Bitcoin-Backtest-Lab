"""Local, trusted Python strategies. This process is NOT a security sandbox."""
import ast
import contextlib
import inspect
import json
import sys
import traceback
from collections.abc import Sequence
from types import MappingProxyType


class History(Sequence):
    def __init__(self):
        self._items = []

    def __len__(self):
        return len(self._items)

    def __getitem__(self, index):
        return self._items[index]


class LimitedLog:
    def __init__(self):
        self.size = 0

    def write(self, text):
        self.size += len(text.encode('utf-8'))
        if self.size > 16384:
            raise ValueError('Python günlük çıktısı 16 KB sınırını aştı. print çağrılarını azaltın.')
        return len(text)

    def flush(self):
        pass


def main():
    # These limits reduce accidental resource exhaustion; they do not isolate code.
    if sys.platform != 'win32':
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        if sys.platform.startswith('linux'):
            resource.setrlimit(resource.RLIMIT_AS, (512 * 1024**2, 512 * 1024**2))
    request = json.load(sys.stdin)
    source = request['strategy']['source']
    tree = ast.parse(source, filename='strategy.py')
    if not any(isinstance(n, ast.FunctionDef) and n.name == 'on_candle' for n in tree.body):
        raise ValueError('def on_candle(candles, state) fonksiyonu gerekli.')
    code = compile(tree, 'strategy.py', 'exec')
    if request['mode'] == 'validate':
        # Checking or importing a strategy must never execute its code.
        return {'ok': True}
    scope = {'__name__': 'strategy'}
    log = LimitedLog()
    with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
        exec(code, scope)
        callback = scope.get('on_candle')
        if not callable(callback):
            raise ValueError('on_candle çağrılabilir bir fonksiyon olmalı.')
        inspect.signature(callback).bind([], {})
        history, state, signals = History(), {}, []
        for candle in request['candles']:
            history._items.append(MappingProxyType(candle))
            signal = callback(history, state)
            if signal is None:
                signal = 'hold'
            if not isinstance(signal, str) or signal not in ('buy', 'sell', 'hold'):
                raise ValueError('Mum %d: on_candle yalnızca buy, sell, hold veya None döndürebilir.' % len(history))
            signals.append(signal)
    return {'signals': signals}


try:
    response = main()
except BaseException as error:
    line = getattr(error, 'lineno', None)
    for frame in traceback.extract_tb(error.__traceback__):
        if frame.filename == 'strategy.py':
            line = frame.lineno
    location = ' (satır %s)' % line if line else ''
    response = {'error': ('Python%s: %s: %s' % (location, type(error).__name__, error))[:2000]}
sys.stdout.write(json.dumps(response, ensure_ascii=True))
