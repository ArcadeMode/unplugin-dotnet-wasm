using TypeShim;

namespace Client.SampleLibrary;

[TSExport]
public class Counter
{
    private int _value;

    public Counter(int initial)
    {
        _value = initial;
    }

    public void Increment() => _value++;

    public int Value => _value;
}
