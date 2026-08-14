using TypeShim;

namespace Client.Library;

[TSExport]
public class Counter
{
    private int _value;

    public Counter(int initial)
    {
        _value = initial;
    }

    // The fixture-builder toggles the step via `-p:LibraryAltered=true` to prove
    // an altered rebuild took effect: baseline increments by 3, altered by 5.
#if LIBRARY_ALTERED
    public void Increment() => _value += 5;
#else
    public void Increment() => _value += 3;
#endif

    public int Value => _value;
}
