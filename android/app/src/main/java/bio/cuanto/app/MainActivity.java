package bio.cuanto.app;

import android.content.pm.ActivityInfo;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Phones are locked to portrait; tablets and other large-screen devices are
    // free to rotate. Mirrors the iOS wrapper's orientation lock (issue #55).
    // 600dp is Android's standard "large screen" breakpoint (7" tablets and up).
    private static final int TABLET_SMALLEST_WIDTH_DP = 600;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        boolean isTablet =
            getResources().getConfiguration().smallestScreenWidthDp >= TABLET_SMALLEST_WIDTH_DP;
        setRequestedOrientation(
            isTablet
                ? ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
                : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        );
        super.onCreate(savedInstanceState);
    }
}
